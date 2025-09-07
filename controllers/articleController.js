// controllers/articleController.js
const mongoose = require("mongoose");
const Article = require("../models/Article");
const Course = require("../models/Course");
const CourseSyllabus = require("../models/CourseSyllabus");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const { ErrorHandler } = require("../middleware/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const {
  uploadFileToAzure,
  deleteFileFromAzure,
} = require("../utils/azureConfig");
const { date } = require("joi");

// Create a new article for a chapter
exports.createArticle = catchAsyncErrors(async (req, res, next) => {
  console.log("createArticle: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { title, content, author, time } = req.body;
    const { courseId, moduleId, chapterId } = req.params;

    console.log(
      `Creating article for course: ${courseId}, module: ${moduleId}, chapter: ${chapterId}`
    );

    // Validate inputs
    if (!title || !content || !author || !date) {
      console.log("Missing required fields");
      return next(new ErrorHandler("All fields are required", 400));
    }

    // Check if user is authorized (teacher only)
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    // Check if course exists and teacher owns it
    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    }).session(session);

    if (!course) {
      console.log("Course not found or teacher not authorized");
      return next(new ErrorHandler("Course not found or unauthorized", 404));
    }

    // Find the syllabus and module
    const syllabus = await CourseSyllabus.findOne({ course: courseId }).session(
      session
    );
    if (!syllabus) {
      console.log(`Course syllabus not found for course: ${courseId}`);
      return next(new ErrorHandler("Course syllabus not found", 404));
    }

    const module = syllabus.modules.id(moduleId);
    if (!module) {
      console.log(`Module not found with ID: ${moduleId}`);
      return next(new ErrorHandler("Module not found", 404));
    }

    const chapter = module.chapters.id(chapterId);
    if (!chapter) {
      console.log(`Chapter not found with ID: ${chapterId}`);
      return next(new ErrorHandler("Chapter not found", 404));
    }

    // Create article object
    const article = new Article({
      title,
      content,
      author,
      time,
      chapter: chapterId,
      course: courseId,
      order: chapter.articles.length + 1,
      image: {
        imageUrl: "",
        imageKey: "",
      },
    });

    // Handle image upload if any
    if (req.files && req.files.image) {
      try {
        const imageFile = req.files.image;
        console.log(
          `Processing image: ${imageFile.name}, type: ${imageFile.mimetype}, size: ${imageFile.size}`
        );

        // Validate image type
        const allowedTypes = [
          "image/jpeg",
          "image/png",
          "image/jpg",
          "image/gif",
          "image/webp",
        ];

        if (!allowedTypes.includes(imageFile.mimetype)) {
          console.log(`Invalid file type: ${imageFile.mimetype}`);
          return next(
            new ErrorHandler(
              `Invalid file type. Allowed types: JPG, PNG, GIF, WEBP`,
              400
            )
          );
        }

        // Validate file size (5MB)
        if (imageFile.size > 5 * 1024 * 1024) {
          console.log(`File too large: ${imageFile.size} bytes`);
          return next(
            new ErrorHandler(`File too large. Maximum size allowed is 5MB`, 400)
          );
        }

        // Upload image to Azure
        const uploadedImage = await uploadFileToAzure(
          imageFile,
          "article-images"
        );
        article.image.imageUrl = uploadedImage.url;
        article.image.imageKey = uploadedImage.key;
        console.log("Image added to article");
      } catch (uploadError) {
        console.error("Error handling image upload:", uploadError);
        return next(
          new ErrorHandler(
            uploadError.message || "Failed to upload image",
            uploadError.statusCode || 500
          )
        );
      }
    }

    // Save article
    console.log("Saving article");
    await article.save({ session });
    console.log(`Article saved with ID: ${article._id}`);

    // Add article to chapter's articles array in syllabus
    chapter.articles.push(article._id);
    await syllabus.save({ session });
    console.log("Article added to chapter in syllabus");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(201).json({
      success: true,
      message: "Article created successfully",
      article,
    });
  } catch (error) {
    console.log(`Error in createArticle: ${error.message}`);

    if (transactionStarted) {
      try {
        console.log("Aborting transaction");
        await session.abortTransaction();
        console.log("Transaction aborted");
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    console.log("Ending session");
    await session.endSession();
    console.log("Session ended");
  }
});

// Get all modules with chapters and articles (similar to dummy data format) - FIXED
exports.getCourseModules = catchAsyncErrors(async (req, res, next) => {
  console.log("getCourseModules: Started");

  try {
    const { courseId } = req.params;
    console.log(`Fetching modules for course: ${courseId}`);

    // Verify user access to course
    if (req.user.role === "teacher") {
      const teacher = await Teacher.findOne({ user: req.user.id });
      if (!teacher) {
        return next(new ErrorHandler("Teacher not found", 404));
      }

      const course = await Course.findOne({
        _id: courseId,
        teacher: teacher._id,
      });

      if (!course) {
        return next(new ErrorHandler("Course not found or unauthorized", 404));
      }
    } else if (req.user.role === "student") {
      const student = await Student.findOne({ user: req.user.id });
      if (!student) {
        return next(new ErrorHandler("Student not found", 404));
      }

      if (!student.courses.includes(courseId)) {
        return next(
          new ErrorHandler("You are not enrolled in this course", 403)
        );
      }
    }

    // Get syllabus with modules - FIXED: Removed sort option from populate
    const syllabus = await CourseSyllabus.findOne({
      course: courseId,
    }).populate({
      path: "modules.chapters.articles",
      model: "Article",
      select: "title content author date time image order",
    });

    if (!syllabus) {
      return res.status(200).json({
        success: true,
        courseId,
        modules: [],
      });
    }

    // Format the response to match the dummy data structure
    const formattedModules = syllabus.modules.map((module) => ({
      id: module.id || module._id,
      name: module.name || module.moduleTitle,
      active: module.active,
      title: module.title || module.moduleTitle,
      chapters: module.chapters.map((chapter) => {
        // FIXED: Sort articles manually after population
        const sortedArticles = chapter.articles
          ? [...chapter.articles].sort(
              (a, b) => (a.order || 0) - (b.order || 0)
            )
          : [];

        return {
          id: chapter.id,
          title: chapter.title,
          description: chapter.description,
          color: chapter.color,
          article:
            sortedArticles.length > 0
              ? {
                  id: sortedArticles[0]._id,
                  title: sortedArticles[0].title,
                  content: sortedArticles[0].content,
                  author: sortedArticles[0].author,
                  date: sortedArticles[0].date
                    .toLocaleDateString("en-US", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                    .toUpperCase(),
                  time: sortedArticles[0].time,
                  image:
                    sortedArticles[0].image.imageUrl ||
                    "/api/placeholder/400/300",
                }
              : null,
          articles: sortedArticles.map((article) => ({
            id: article._id,
            title: article.title,
            content: article.content,
            author: article.author,
            date: article.date
              .toLocaleDateString("en-US", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })
              .toUpperCase(),
            time: article.time,
            image: article.image.imageUrl || "/api/placeholder/400/300",
          })),
        };
      }),
    }));

    res.status(200).json({
      success: true,
      courseId,
      modules: formattedModules,
    });
  } catch (error) {
    console.log(`Error in getCourseModules: ${error.message}`);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Create a new chapter in a module
exports.createChapter = catchAsyncErrors(async (req, res, next) => {
  console.log("createChapter: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { title, description, color } = req.body;
    const { courseId, moduleId } = req.params;

    console.log(
      `Creating chapter for course: ${courseId}, module: ${moduleId}`
    );

    // Validate inputs
    if (!title || !description) {
      console.log("Missing required fields");
      return next(new ErrorHandler("Title and description are required", 400));
    }

    // Check if user is authorized (teacher only)
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    // Check if course exists and teacher owns it
    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    }).session(session);

    if (!course) {
      console.log("Course not found or teacher not authorized");
      return next(new ErrorHandler("Course not found or unauthorized", 404));
    }

    // Find the syllabus and module
    const syllabus = await CourseSyllabus.findOne({ course: courseId }).session(
      session
    );
    if (!syllabus) {
      console.log(`Course syllabus not found for course: ${courseId}`);
      return next(new ErrorHandler("Course syllabus not found", 404));
    }

    const module = syllabus.modules.id(moduleId);
    if (!module) {
      console.log(`Module not found with ID: ${moduleId}`);
      return next(new ErrorHandler("Module not found", 404));
    }

    // Get next chapter ID
    const nextId =
      module.chapters.length > 0
        ? Math.max(...module.chapters.map((c) => c.id || 0)) + 1
        : 1;

    // Create new chapter
    const newChapter = {
      id: nextId,
      title,
      description,
      color: color || "bg-blue-500",
      articles: [],
      isActive: true,
      order: nextId,
    };

    // Add chapter to module
    module.chapters.push(newChapter);
    await syllabus.save({ session });

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(201).json({
      success: true,
      message: "Chapter created successfully",
      chapter: newChapter,
    });
  } catch (error) {
    console.log(`Error in createChapter: ${error.message}`);

    if (transactionStarted) {
      try {
        console.log("Aborting transaction");
        await session.abortTransaction();
        console.log("Transaction aborted");
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    console.log("Ending session");
    await session.endSession();
    console.log("Session ended");
  }
});

// Get specific article by ID
exports.getArticleById = catchAsyncErrors(async (req, res, next) => {
  console.log("getArticleById: Started");

  try {
    const { articleId } = req.params;
    console.log(`Fetching article: ${articleId}`);

    const article = await Article.findById(articleId);
    if (!article) {
      console.log("Article not found");
      return next(new ErrorHandler("Article not found", 404));
    }

    // Verify user access to the course
    if (req.user.role === "teacher") {
      const teacher = await Teacher.findOne({ user: req.user.id });
      if (!teacher) {
        return next(new ErrorHandler("Teacher not found", 404));
      }

      const course = await Course.findOne({
        _id: article.course,
        teacher: teacher._id,
      });

      if (!course) {
        return next(new ErrorHandler("Unauthorized access", 403));
      }
    } else if (req.user.role === "student") {
      const student = await Student.findOne({ user: req.user.id });
      if (!student) {
        return next(new ErrorHandler("Student not found", 404));
      }

      if (!student.courses.includes(article.course.toString())) {
        return next(
          new ErrorHandler("You are not enrolled in this course", 403)
        );
      }
    }

    res.status(200).json({
      success: true,
      article: {
        id: article._id,
        title: article.title,
        content: article.content,
        author: article.author,
        date: article.date
          .toLocaleDateString("en-US", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
          .toUpperCase(),
        time: article.time,
        image: article.image.imageUrl || "/api/placeholder/400/300",
      },
    });
  } catch (error) {
    console.log(`Error in getArticleById: ${error.message}`);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Update article
exports.updateArticle = catchAsyncErrors(async (req, res, next) => {
  console.log("updateArticle: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { title, content, author, time } = req.body;
    const { articleId } = req.params;

    console.log(`Updating article: ${articleId}`);

    // Check if user is authorized (teacher only)
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    // Find article
    const article = await Article.findById(articleId).session(session);
    if (!article) {
      console.log("Article not found");
      return next(new ErrorHandler("Article not found", 404));
    }

    // Check if teacher owns the course
    const course = await Course.findOne({
      _id: article.course,
      teacher: teacher._id,
    }).session(session);

    if (!course) {
      console.log("Teacher not authorized for this course");
      return next(new ErrorHandler("Unauthorized", 403));
    }

    // Update article fields
    if (title) article.title = title;
    if (content) article.content = content;
    if (author) article.author = author;
    if (time) article.time = time;

    // Handle image upload if any
    if (req.files && req.files.image) {
      try {
        const imageFile = req.files.image;
        console.log(`Processing new image: ${imageFile.name}`);

        // Validate image type
        const allowedTypes = [
          "image/jpeg",
          "image/png",
          "image/jpg",
          "image/gif",
          "image/webp",
        ];

        if (!allowedTypes.includes(imageFile.mimetype)) {
          return next(
            new ErrorHandler(
              `Invalid file type. Allowed types: JPG, PNG, GIF, WEBP`,
              400
            )
          );
        }

        // Validate file size (5MB)
        if (imageFile.size > 5 * 1024 * 1024) {
          return next(
            new ErrorHandler(`File too large. Maximum size allowed is 5MB`, 400)
          );
        }

        // Delete old image from Azure if it exists
        if (article.image && article.image.imageKey) {
          try {
            await deleteFileFromAzure(article.image.imageKey);
            console.log("Old image deleted from Azure");
          } catch (azureError) {
            console.error("Error deleting image from Azure:", azureError);
          }
        }

        // Upload new image to Azure
        const uploadedImage = await uploadFileToAzure(
          imageFile,
          "article-images"
        );
        article.image.imageUrl = uploadedImage.url;
        article.image.imageKey = uploadedImage.key;
        console.log("New image added to article");
      } catch (uploadError) {
        console.error("Error handling image upload:", uploadError);
        return next(
          new ErrorHandler(
            uploadError.message || "Failed to upload image",
            uploadError.statusCode || 500
          )
        );
      }
    }

    console.log("Saving updated article");
    await article.save({ session });
    console.log("Article updated");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(200).json({
      success: true,
      message: "Article updated successfully",
      article,
    });
  } catch (error) {
    console.log(`Error in updateArticle: ${error.message}`);

    if (transactionStarted) {
      try {
        console.log("Aborting transaction");
        await session.abortTransaction();
        console.log("Transaction aborted");
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    console.log("Ending session");
    await session.endSession();
    console.log("Session ended");
  }
});

// Delete article
exports.deleteArticle = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteArticle: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { articleId } = req.params;
    console.log(`Deleting article: ${articleId}`);

    // Check if user is authorized (teacher only)
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    // Find article
    const article = await Article.findById(articleId).session(session);
    if (!article) {
      console.log("Article not found");
      return next(new ErrorHandler("Article not found", 404));
    }

    // Check if teacher owns the course
    const course = await Course.findOne({
      _id: article.course,
      teacher: teacher._id,
    }).session(session);

    if (!course) {
      console.log("Teacher not authorized for this course");
      return next(new ErrorHandler("Unauthorized", 403));
    }

    // Delete image from Azure if it exists
    if (article.image && article.image.imageKey) {
      try {
        await deleteFileFromAzure(article.image.imageKey);
        console.log("Image deleted from Azure");
      } catch (azureError) {
        console.error("Error deleting image from Azure:", azureError);
      }
    }

    // Remove article from chapter in syllabus
    const syllabus = await CourseSyllabus.findOne({
      course: article.course,
    }).session(session);
    if (syllabus) {
      syllabus.modules.forEach((module) => {
        module.chapters.forEach((chapter) => {
          chapter.articles = chapter.articles.filter(
            (id) => !id.equals(article._id)
          );
        });
      });
      await syllabus.save({ session });
      console.log("Article removed from syllabus");
    }

    // Delete the article
    await Article.findByIdAndDelete(articleId).session(session);
    console.log("Article deleted");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(200).json({
      success: true,
      message: "Article deleted successfully",
    });
  } catch (error) {
    console.log(`Error in deleteArticle: ${error.message}`);

    if (transactionStarted) {
      try {
        console.log("Aborting transaction");
        await session.abortTransaction();
        console.log("Transaction aborted");
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    console.log("Ending session");
    await session.endSession();
    console.log("Session ended");
  }
});
exports.deleteChapter = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteChapter: Started (Articles Controller)");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { courseId, moduleId, chapterId } = req.params;

    console.log(
      `Deleting chapter ${chapterId} for course: ${courseId}, module: ${moduleId}`
    );

    // Check if user is authorized (teacher only)
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    // Check if course exists and teacher owns it
    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    }).session(session);

    if (!course) {
      console.log("Course not found or teacher not authorized");
      return next(new ErrorHandler("Course not found or unauthorized", 404));
    }

    // Find the syllabus and module
    const syllabus = await CourseSyllabus.findOne({ course: courseId }).session(
      session
    );
    if (!syllabus) {
      console.log(`Course syllabus not found for course: ${courseId}`);
      return next(new ErrorHandler("Course syllabus not found", 404));
    }

    const module = syllabus.modules.id(moduleId);
    if (!module) {
      console.log(`Module not found with ID: ${moduleId}`);
      return next(new ErrorHandler("Module not found", 404));
    }

    const chapter = module.chapters.id(chapterId);
    if (!chapter) {
      console.log(`Chapter not found with ID: ${chapterId}`);
      return next(new ErrorHandler("Chapter not found", 404));
    }

    // Delete all articles in this chapter first
    if (chapter.articles && chapter.articles.length > 0) {
      console.log(`Deleting ${chapter.articles.length} articles in chapter`);

      // Get all articles to delete their images from Azure
      const articles = await Article.find({
        _id: { $in: chapter.articles },
      }).session(session);

      // Delete article images from Azure
      for (const article of articles) {
        if (article.image && article.image.imageKey) {
          try {
            await deleteFileFromAzure(article.image.imageKey);
            console.log(`Deleted article image: ${article.image.imageKey}`);
          } catch (azureError) {
            console.error(
              "Error deleting article image from Azure:",
              azureError
            );
          }
        }
      }

      // Delete articles from Article collection
      await Article.deleteMany({ _id: { $in: chapter.articles } }).session(
        session
      );
      console.log(
        `Deleted ${chapter.articles.length} articles from Article collection`
      );
    }

    // Remove chapter from module
    module.chapters.pull({ _id: chapterId });
    await syllabus.save({ session });
    console.log("Chapter removed from module");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(200).json({
      success: true,
      message: "Chapter deleted successfully",
      data: {
        courseId: courseId,
        moduleId: moduleId,
        chapterId: chapterId,
        deletedArticles: chapter.articles ? chapter.articles.length : 0,
      },
    });
  } catch (error) {
    console.log(`Error in deleteChapter: ${error.message}`);

    if (transactionStarted) {
      try {
        console.log("Aborting transaction");
        await session.abortTransaction();
        console.log("Transaction aborted");
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    console.log("Ending session");
    await session.endSession();
    console.log("Session ended");
  }
});
module.exports = exports;
