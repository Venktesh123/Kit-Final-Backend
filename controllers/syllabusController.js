// controllers/syllabusController.js (Updated with link field support)
const mongoose = require("mongoose");
const Course = require("../models/Course");
const CourseSyllabus = require("../models/CourseSyllabus");
const Article = require("../models/Article");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const { ErrorHandler } = require("../middleware/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const {
  uploadFileToAzure,
  deleteFileFromAzure,
} = require("../utils/azureConfig");

// Function to handle file uploads
const handleFileUploads = async (files, allowedTypes, path, next) => {
  console.log("Processing file uploads");

  let filesArray = Array.isArray(files) ? files : [files];
  console.log(`Found ${filesArray.length} files`);

  // Validate file types
  for (const file of filesArray) {
    console.log(
      `Validating file: ${file.name}, type: ${file.mimetype}, size: ${file.size}`
    );

    if (!allowedTypes.includes(file.mimetype)) {
      console.log(`Invalid file type: ${file.mimetype}`);
      throw new ErrorHandler(
        `Invalid file type. Allowed types: ${allowedTypes.join(", ")}`,
        400
      );
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      console.log(`File too large: ${file.size} bytes`);
      throw new ErrorHandler(
        `File too large. Maximum size allowed is 10MB`,
        400
      );
    }
  }

  // Upload files to Azure
  console.log("Starting file uploads to Azure");
  const uploadPromises = filesArray.map((file) =>
    uploadFileToAzure(file, path)
  );

  const uploadedFiles = await Promise.all(uploadPromises);
  console.log(`Successfully uploaded ${uploadedFiles.length} files`);

  return { filesArray, uploadedFiles };
};

// Get course syllabus with modules, chapters, and articles - UPDATED
exports.getCourseSyllabus = catchAsyncErrors(async (req, res, next) => {
  console.log("getCourseSyllabus: Started");
  const { courseId } = req.params;

  console.log(`Fetching syllabus for course: ${courseId}`);

  // Check if course exists
  const course = await Course.findById(courseId);
  if (!course) {
    console.log(`Course not found: ${courseId}`);
    return next(new ErrorHandler("Course not found", 404));
  }

  // Verify user access based on role
  if (req.user.role === "teacher") {
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      return next(new ErrorHandler("Teacher not found", 404));
    }

    const teacherCourse = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    });

    if (!teacherCourse) {
      return next(new ErrorHandler("Unauthorized access to this course", 403));
    }
  } else if (req.user.role === "student") {
    const student = await Student.findOne({ user: req.user.id });
    if (!student) {
      return next(new ErrorHandler("Student not found", 404));
    }

    const isEnrolled = student.courses.some((id) => id.toString() === courseId);
    if (!isEnrolled) {
      return next(new ErrorHandler("You are not enrolled in this course", 403));
    }
  }

  // Find CourseSyllabus with populated articles
  const syllabus = await CourseSyllabus.findOne({ course: courseId }).populate({
    path: "modules.chapters.articles",
    model: "Article",
    select: "title content author date time image order",
  });

  if (!syllabus) {
    console.log(`No syllabus found for course: ${courseId}`);
    return res.status(200).json({
      success: true,
      courseId: courseId,
      syllabus: {
        course: courseId,
        modules: [],
        _id: null,
        createdAt: null,
        updatedAt: null,
      },
    });
  }

  // Format the response with enhanced module data
  const formattedSyllabus = {
    _id: syllabus._id,
    course: syllabus.course,
    modules: syllabus.modules.map((module) => ({
      _id: module._id,
      id: module.id,
      name: module.name,
      active: module.active,
      title: module.title,
      moduleNumber: module.moduleNumber,
      moduleTitle: module.moduleTitle,
      description: module.description,
      topics: module.topics,
      isActive: module.isActive,
      order: module.order,
      chapters: module.chapters.map((chapter) => ({
        _id: chapter._id,
        id: chapter.id,
        title: chapter.title,
        description: chapter.description,
        color: chapter.color,
        isActive: chapter.isActive,
        order: chapter.order,
        // UPDATED: Include the new link field
        link: chapter.link || [],
        // Sort articles manually after population
        articles: chapter.articles
          ? [...chapter.articles]
              .sort((a, b) => (a.order || 0) - (b.order || 0))
              .map((article) => ({
                _id: article._id,
                title: article.title,
                content: article.content,
                author: article.author,
                date: article.date,
                time: article.time,
                image: article.image,
                order: article.order,
              }))
          : [],
        articleCount: chapter.articles ? chapter.articles.length : 0,
      })),
      contentItems: module.contentItems || [],
      resources: module.resources || [],
      lectures: module.lectures || [],
      link: module.link || "",
      chapterCount: module.chapters.length,
      hasContent:
        module.contentItems?.length > 0 ||
        module.resources?.length > 0 ||
        module.lectures?.length > 0,
    })),
    createdAt: syllabus.createdAt,
    updatedAt: syllabus.updatedAt,
    moduleCount: syllabus.modules.length,
  };

  res.status(200).json({
    success: true,
    courseId: courseId,
    syllabus: formattedSyllabus,
  });
});

// Create a new module with proper structure
exports.createModule = catchAsyncErrors(async (req, res, next) => {
  console.log("createModule: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const {
      name,
      title,
      moduleNumber,
      moduleTitle,
      description,
      topics,
      active,
    } = req.body;
    const { courseId } = req.params;

    console.log(`Creating module for course: ${courseId}`);

    // Validate inputs
    if (!name || !title || !moduleNumber || !moduleTitle) {
      console.log("Missing required fields");
      return next(
        new ErrorHandler(
          "Name, title, moduleNumber, and moduleTitle are required",
          400
        )
      );
    }

    // Check if teacher is authorized
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    });

    if (!course) {
      console.log("Course not found or teacher not authorized");
      return next(new ErrorHandler("Course not found or unauthorized", 404));
    }

    // Find or create syllabus
    let syllabus = await CourseSyllabus.findOne({ course: courseId }).session(
      session
    );

    if (!syllabus) {
      syllabus = new CourseSyllabus({
        course: courseId,
        modules: [],
      });
    }

    // Check if module number already exists
    const existingModule = syllabus.modules.find(
      (m) => m.moduleNumber === moduleNumber
    );
    if (existingModule) {
      return next(
        new ErrorHandler(
          `Module with number ${moduleNumber} already exists`,
          400
        )
      );
    }

    // Get next module ID
    const nextId =
      syllabus.modules.length > 0
        ? Math.max(...syllabus.modules.map((m) => m.id || 0)) + 1
        : 1;

    // Create new module
    const newModule = {
      id: nextId,
      name,
      active: active || false,
      title,
      moduleNumber: moduleNumber || nextId,
      moduleTitle,
      description: description || "",
      topics: topics || [],
      chapters: [],
      lectures: [],
      contentItems: [],
      resources: [],
      link: "",
      isActive: true,
      order: nextId,
    };

    syllabus.modules.push(newModule);
    await syllabus.save({ session });

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(201).json({
      success: true,
      message: "Module created successfully",
      module: newModule,
    });
  } catch (error) {
    console.log(`Error in createModule: ${error.message}`);
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

// Create a chapter within a module - UPDATED
exports.createChapter = catchAsyncErrors(async (req, res, next) => {
  console.log("createChapter: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { title, description, color, link } = req.body; // UPDATED: Include link
    const { courseId, moduleId } = req.params;

    console.log(
      `Creating chapter for course: ${courseId}, module: ${moduleId}`
    );

    // Validate inputs
    if (!title || !description) {
      console.log("Missing required fields");
      return next(new ErrorHandler("Title and description are required", 400));
    }

    // Check authorization
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    });

    if (!course) {
      console.log("Course not found or teacher not authorized");
      return next(new ErrorHandler("Course not found or unauthorized", 404));
    }

    // Find syllabus and module
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

    // Create new chapter with link field
    const newChapter = {
      id: nextId,
      title,
      description,
      color: color || "bg-blue-500",
      articles: [],
      // UPDATED: Include the new link field
      link: Array.isArray(link) ? link : link ? [link] : [],
      isActive: true,
      order: nextId,
    };

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

// Update chapter - UPDATED
exports.updateChapter = catchAsyncErrors(async (req, res, next) => {
  console.log("updateChapter: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { title, description, color, isActive, order, link } = req.body; // UPDATED: Include link
    const { courseId, moduleId, chapterId } = req.params;

    console.log(
      `Updating chapter ${chapterId} for course: ${courseId}, module: ${moduleId}`
    );

    // Validate inputs
    if (
      !title &&
      !description &&
      color === undefined &&
      isActive === undefined &&
      order === undefined &&
      link === undefined // UPDATED: Include link in validation
    ) {
      console.log("No update fields provided");
      return next(
        new ErrorHandler("At least one field must be provided for update", 400)
      );
    }

    // Check authorization
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    });

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

    // Update chapter fields
    if (title) {
      chapter.title = title;
      console.log(`Updated chapter title to: ${title}`);
    }

    if (description) {
      chapter.description = description;
      console.log(`Updated chapter description`);
    }

    if (color) {
      chapter.color = color;
      console.log(`Updated chapter color to: ${color}`);
    }

    if (isActive !== undefined) {
      chapter.isActive = isActive;
      console.log(`Updated chapter isActive to: ${isActive}`);
    }

    // UPDATED: Handle link field update
    if (link !== undefined) {
      chapter.link = Array.isArray(link) ? link : link ? [link] : [];
      console.log(`Updated chapter links to: ${chapter.link}`);
    }

    if (order !== undefined) {
      // Check if order is already taken by another chapter in the same module
      const existingChapterWithOrder = module.chapters.find(
        (ch) => ch.order === order && ch._id.toString() !== chapterId
      );

      if (existingChapterWithOrder) {
        console.log(`Order ${order} is already taken by another chapter`);
        return next(
          new ErrorHandler(
            `Order ${order} is already taken by another chapter in this module`,
            400
          )
        );
      }

      chapter.order = order;
      console.log(`Updated chapter order to: ${order}`);
    }

    await syllabus.save({ session });
    console.log("Chapter updated successfully");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    // Return the updated chapter with populated articles count
    const updatedChapter = {
      _id: chapter._id,
      id: chapter.id,
      title: chapter.title,
      description: chapter.description,
      color: chapter.color,
      isActive: chapter.isActive,
      order: chapter.order,
      // UPDATED: Include link in response
      link: chapter.link || [],
      articleCount: chapter.articles ? chapter.articles.length : 0,
      articles: chapter.articles || [],
    };

    res.status(200).json({
      success: true,
      message: "Chapter updated successfully",
      chapter: updatedChapter,
    });
  } catch (error) {
    console.log(`Error in updateChapter: ${error.message}`);
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

// Delete chapter
exports.deleteChapter = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteChapter: Started");
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

    // Check authorization
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    });

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
      courseId: courseId,
      moduleId: moduleId,
      chapterId: chapterId,
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

// Create an article within a chapter
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
    if (!title || !content || !author || !time) {
      console.log("Missing required fields");
      return next(
        new ErrorHandler("Title, content, author, and time are required", 400)
      );
    }

    // Check authorization
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    });

    if (!course) {
      console.log("Course not found or teacher not authorized");
      return next(new ErrorHandler("Course not found or unauthorized", 404));
    }

    // Find syllabus, module, and chapter
    const syllabus = await CourseSyllabus.findOne({ course: courseId }).session(
      session
    );
    if (!syllabus) {
      return next(new ErrorHandler("Course syllabus not found", 404));
    }

    const module = syllabus.modules.id(moduleId);
    if (!module) {
      return next(new ErrorHandler("Module not found", 404));
    }

    const chapter = module.chapters.id(chapterId);
    if (!chapter) {
      return next(new ErrorHandler("Chapter not found", 404));
    }

    // Create article
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

        // Validate image type
        const allowedTypes = [
          "image/jpeg",
          "image/png",
          "image/jpg",
          "image/gif",
          "image/webp",
        ];

        if (!allowedTypes.includes(imageFile.mimetype)) {
          return next(new ErrorHandler("Invalid image file type", 400));
        }

        // Validate file size (5MB)
        if (imageFile.size > 5 * 1024 * 1024) {
          return next(
            new ErrorHandler("Image file too large. Maximum size is 5MB", 400)
          );
        }

        // Upload image to Azure
        const uploadedImage = await uploadFileToAzure(
          imageFile,
          "article-images"
        );
        article.image.imageUrl = uploadedImage.url;
        article.image.imageKey = uploadedImage.key;
      } catch (uploadError) {
        console.error("Error uploading image:", uploadError);
        return next(new ErrorHandler("Failed to upload image", 500));
      }
    }

    // Save article
    await article.save({ session });

    // Add article to chapter
    chapter.articles.push(article._id);
    await syllabus.save({ session });

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(201).json({
      success: true,
      message: "Article created successfully",
      article: {
        _id: article._id,
        title: article.title,
        content: article.content,
        author: article.author,
        time: article.time,
        image: article.image,
        order: article.order,
        chapter: article.chapter,
        course: article.course,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
      },
    });
  } catch (error) {
    console.log(`Error in createArticle: ${error.message}`);
    if (transactionStarted) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }
    return next(new ErrorHandler(error.message, 500));
  } finally {
    await session.endSession();
  }
});

// Update module status (activate/deactivate)
exports.updateModuleStatus = catchAsyncErrors(async (req, res, next) => {
  console.log("updateModuleStatus: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const { active } = req.body;
    const { courseId, moduleId } = req.params;

    console.log(
      `Updating module status for course: ${courseId}, module: ${moduleId}`
    );

    // Check authorization
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

    // Find and update module
    const syllabus = await CourseSyllabus.findOne({ course: courseId }).session(
      session
    );
    if (!syllabus) {
      return next(new ErrorHandler("Course syllabus not found", 404));
    }

    const module = syllabus.modules.id(moduleId);
    if (!module) {
      return next(new ErrorHandler("Module not found", 404));
    }

    // Update active status
    if (active !== undefined) {
      module.active = active;
    }

    await syllabus.save({ session });

    await session.commitTransaction();
    transactionStarted = false;

    res.status(200).json({
      success: true,
      message: "Module status updated successfully",
      module: {
        _id: module._id,
        id: module.id,
        name: module.name,
        active: module.active,
        title: module.title,
        moduleNumber: module.moduleNumber,
        moduleTitle: module.moduleTitle,
      },
    });
  } catch (error) {
    console.log(`Error in updateModuleStatus: ${error.message}`);
    if (transactionStarted) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }
    return next(new ErrorHandler(error.message, 500));
  } finally {
    await session.endSession();
  }
});

// Get specific module by ID with enhanced data - UPDATED
exports.getModuleById = catchAsyncErrors(async (req, res, next) => {
  console.log("getModuleById: Started");
  const { courseId, moduleId } = req.params;

  console.log(`Fetching module ${moduleId} for course: ${courseId}`);

  // Verify user access
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
      return next(new ErrorHandler("Unauthorized access to this course", 403));
    }
  } else if (req.user.role === "student") {
    const student = await Student.findOne({ user: req.user.id });
    if (!student) {
      return next(new ErrorHandler("Student not found", 404));
    }

    const isEnrolled = student.courses.some((id) => id.toString() === courseId);
    if (!isEnrolled) {
      return next(new ErrorHandler("You are not enrolled in this course", 403));
    }
  }

  // Find CourseSyllabus
  const syllabus = await CourseSyllabus.findOne({ course: courseId }).populate({
    path: "modules.chapters.articles",
    model: "Article",
    select: "title content author date time image order",
  });

  if (!syllabus) {
    console.log(`No syllabus found for course: ${courseId}`);
    return next(new ErrorHandler("No syllabus found for this course", 404));
  }

  // Find specific module
  const module = syllabus.modules.id(moduleId);
  if (!module) {
    console.log(`Module not found: ${moduleId}`);
    return next(new ErrorHandler("Module not found", 404));
  }

  // Format module with enhanced data
  const formattedModule = {
    _id: module._id,
    id: module.id,
    name: module.name,
    active: module.active,
    title: module.title,
    moduleNumber: module.moduleNumber,
    moduleTitle: module.moduleTitle,
    description: module.description,
    topics: module.topics,
    isActive: module.isActive,
    order: module.order,
    link: module.link,
    chapters: module.chapters.map((chapter) => ({
      _id: chapter._id,
      id: chapter.id,
      title: chapter.title,
      description: chapter.description,
      color: chapter.color,
      isActive: chapter.isActive,
      order: chapter.order,
      // UPDATED: Include the new link field
      link: chapter.link || [],
      // Sort articles manually after population
      articles: chapter.articles
        ? [...chapter.articles]
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map((article) => ({
              _id: article._id,
              title: article.title,
              content: article.content,
              author: article.author,
              date: article.date,
              time: article.time,
              image: article.image,
              order: article.order,
            }))
        : [],
      articleCount: chapter.articles ? chapter.articles.length : 0,
    })),
    contentItems: module.contentItems || [],
    resources: module.resources || [],
    lectures: module.lectures || [],
    chapterCount: module.chapters.length,
    totalArticles: module.chapters.reduce(
      (total, chapter) =>
        total + (chapter.articles ? chapter.articles.length : 0),
      0
    ),
    hasContent:
      module.contentItems?.length > 0 ||
      module.resources?.length > 0 ||
      module.lectures?.length > 0,
  };

  res.status(200).json({
    success: true,
    courseId: courseId,
    moduleId: moduleId,
    module: formattedModule,
  });
});

// Delete module
exports.deleteModule = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteModule: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { courseId, moduleId } = req.params;

    console.log(`Deleting module ${moduleId} for course: ${courseId}`);

    // Check authorization
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

    // Find syllabus and module
    const syllabus = await CourseSyllabus.findOne({ course: courseId }).session(
      session
    );
    if (!syllabus) {
      return next(new ErrorHandler("Course syllabus not found", 404));
    }

    const module = syllabus.modules.id(moduleId);
    if (!module) {
      return next(new ErrorHandler("Module not found", 404));
    }

    // Delete all articles in this module's chapters
    const articleIds = [];
    module.chapters.forEach((chapter) => {
      articleIds.push(...chapter.articles);
    });

    if (articleIds.length > 0) {
      await Article.deleteMany({ _id: { $in: articleIds } }).session(session);
      console.log(`Deleted ${articleIds.length} articles`);
    }

    // Delete content files from Azure
    if (module.contentItems && module.contentItems.length > 0) {
      console.log(
        `Deleting ${module.contentItems.length} content files from Azure`
      );

      for (const contentItem of module.contentItems) {
        try {
          if (contentItem.fileKey) {
            await deleteFileFromAzure(contentItem.fileKey);
          } else if (contentItem.videoKey) {
            await deleteFileFromAzure(contentItem.videoKey);
          }
        } catch (azureError) {
          console.error("Error deleting content file from Azure:", azureError);
        }
      }
    }

    // Delete resource files from Azure
    if (module.resources && module.resources.length > 0) {
      console.log(
        `Deleting ${module.resources.length} resource files from Azure`
      );

      for (const resource of module.resources) {
        try {
          if (resource.fileKey) {
            await deleteFileFromAzure(resource.fileKey);
          }
        } catch (azureError) {
          console.error("Error deleting resource file from Azure:", azureError);
        }
      }
    }

    // Remove module from syllabus
    syllabus.modules.pull({ _id: moduleId });
    await syllabus.save({ session });

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(200).json({
      success: true,
      message: "Module deleted successfully",
      courseId: courseId,
      moduleId: moduleId,
    });
  } catch (error) {
    console.log(`Error in deleteModule: ${error.message}`);
    if (transactionStarted) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }
    return next(new ErrorHandler(error.message, 500));
  } finally {
    await session.endSession();
  }
});

// Update module basic info
exports.updateModule = catchAsyncErrors(async (req, res, next) => {
  console.log("updateModule: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const {
      name,
      title,
      moduleNumber,
      moduleTitle,
      description,
      topics,
      active,
    } = req.body;
    const { courseId, moduleId } = req.params;

    console.log(`Updating module ${moduleId} for course: ${courseId}`);

    // Check authorization
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

    // Find and update module
    const syllabus = await CourseSyllabus.findOne({ course: courseId }).session(
      session
    );
    if (!syllabus) {
      return next(new ErrorHandler("Course syllabus not found", 404));
    }

    const module = syllabus.modules.id(moduleId);
    if (!module) {
      return next(new ErrorHandler("Module not found", 404));
    }

    // Check if new module number already exists (if changing)
    if (moduleNumber && moduleNumber !== module.moduleNumber) {
      const existingModule = syllabus.modules.find(
        (m) => m.moduleNumber === moduleNumber && m._id.toString() !== moduleId
      );
      if (existingModule) {
        return next(
          new ErrorHandler(
            `Module with number ${moduleNumber} already exists`,
            400
          )
        );
      }
    }

    // Update module details
    if (name) module.name = name;
    if (title) module.title = title;
    if (moduleNumber) module.moduleNumber = moduleNumber;
    if (moduleTitle) module.moduleTitle = moduleTitle;
    if (description !== undefined) module.description = description;
    if (topics) module.topics = topics;
    if (active !== undefined) module.active = active;

    await syllabus.save({ session });

    await session.commitTransaction();
    transactionStarted = false;

    res.status(200).json({
      success: true,
      message: "Module updated successfully",
      courseId: courseId,
      moduleId: moduleId,
      module: {
        _id: module._id,
        id: module.id,
        name: module.name,
        active: module.active,
        title: module.title,
        moduleNumber: module.moduleNumber,
        moduleTitle: module.moduleTitle,
        description: module.description,
        topics: module.topics,
        isActive: module.isActive,
        order: module.order,
      },
    });
  } catch (error) {
    console.log(`Error in updateModule: ${error.message}`);
    if (transactionStarted) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }
    return next(new ErrorHandler(error.message, 500));
  } finally {
    await session.endSession();
  }
});

// Add content to module (keeping existing functionality)
exports.addModuleContent = catchAsyncErrors(async (req, res, next) => {
  console.log("addModuleContent: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { courseId, moduleId } = req.params;
    const { contentType, title, description } = req.body;

    console.log(
      `Adding ${contentType} content to module ${moduleId} for course: ${courseId}`
    );

    // Validate content type
    if (!["file", "link", "video", "text"].includes(contentType)) {
      return next(
        new ErrorHandler(
          "Invalid content type. Must be file, link, video, or text",
          400
        )
      );
    }

    // Check if teacher is authorized to modify this course
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    });

    if (!course) {
      console.log("Course not found or teacher not authorized");
      return next(new ErrorHandler("Course not found or unauthorized", 404));
    }

    // Find CourseSyllabus
    const syllabus = await CourseSyllabus.findOne({ course: courseId }).session(
      session
    );
    if (!syllabus) {
      console.log(`No syllabus found for course: ${courseId}`);
      return next(new ErrorHandler("No syllabus found for this course", 404));
    }

    // Find specific module
    const module = syllabus.modules.id(moduleId);
    if (!module) {
      console.log(`Module not found: ${moduleId}`);
      return next(new ErrorHandler("Module not found", 404));
    }

    // Initialize contentItems array if it doesn't exist
    if (!module.contentItems) {
      module.contentItems = [];
    }

    // Create base content item
    const contentItem = {
      type: contentType,
      title: title || "Untitled Content",
      description: description || "",
      order: module.contentItems.length + 1,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Process content based on type
    switch (contentType) {
      case "file":
        // Handle file upload
        if (!req.files || !req.files.file) {
          return next(new ErrorHandler("No file uploaded", 400));
        }

        try {
          const allowedTypes = [
            "application/pdf",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "image/jpeg",
            "image/png",
            "image/gif",
          ];

          const { filesArray, uploadedFiles } = await handleFileUploads(
            req.files.file,
            allowedTypes,
            "syllabus-files",
            next
          );

          const file = filesArray[0];
          const uploadedFile = uploadedFiles[0];

          // Determine file type
          let fileType = "other";
          if (file.mimetype === "application/pdf") {
            fileType = "pdf";
          } else if (
            file.mimetype === "application/vnd.ms-powerpoint" ||
            file.mimetype ===
              "application/vnd.openxmlformats-officedocument.presentationml.presentation"
          ) {
            fileType = "presentation";
          } else if (
            file.mimetype === "application/msword" ||
            file.mimetype ===
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          ) {
            fileType = "document";
          } else if (file.mimetype.startsWith("image/")) {
            fileType = "image";
          }

          // Add file-specific properties
          contentItem.fileType = fileType;
          contentItem.fileName = file.name;
          contentItem.fileUrl = uploadedFile.url;
          contentItem.fileKey = uploadedFile.key;
        } catch (uploadError) {
          console.error("Error handling file upload:", uploadError);
          return next(
            new ErrorHandler(
              uploadError.message || "Failed to upload file",
              uploadError.statusCode || 500
            )
          );
        }
        break;

      case "link":
        // Handle link
        const { url } = req.body;
        if (!url) {
          return next(
            new ErrorHandler("URL is required for link content type", 400)
          );
        }

        contentItem.url = url;
        break;

      case "video":
        // Handle video
        const { videoUrl, videoProvider } = req.body;
        if (!videoUrl) {
          return next(
            new ErrorHandler(
              "Video URL is required for video content type",
              400
            )
          );
        }

        contentItem.videoUrl = videoUrl;
        contentItem.videoProvider = videoProvider || "other";

        // If video file is uploaded instead of URL
        if (req.files && req.files.videoFile) {
          try {
            const allowedTypes = ["video/mp4", "video/webm", "video/ogg"];

            const { filesArray, uploadedFiles } = await handleFileUploads(
              req.files.videoFile,
              allowedTypes,
              "syllabus-videos",
              next
            );

            const uploadedFile = uploadedFiles[0];

            // Override videoUrl with the uploaded file URL
            contentItem.videoUrl = uploadedFile.url;
            contentItem.videoKey = uploadedFile.key;
          } catch (uploadError) {
            console.error("Error handling video upload:", uploadError);
            return next(
              new ErrorHandler(
                uploadError.message || "Failed to upload video",
                uploadError.statusCode || 500
              )
            );
          }
        }
        break;

      case "text":
        // Handle text content
        const { content } = req.body;
        if (!content) {
          return next(
            new ErrorHandler("Content is required for text content type", 400)
          );
        }

        contentItem.content = content;
        break;
    }

    // Add new content item to module
    module.contentItems.push(contentItem);

    console.log("Saving updated syllabus");
    await syllabus.save({ session });
    console.log("Syllabus updated with new content item");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(201).json({
      success: true,
      message: "Content added to module successfully",
      contentItem: module.contentItems[module.contentItems.length - 1],
    });
  } catch (error) {
    console.log(`Error in addModuleContent: ${error.message}`);
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

// Update content item (keeping existing functionality)
exports.updateContentItem = catchAsyncErrors(async (req, res, next) => {
  console.log("updateContentItem: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { courseId, moduleId, contentId } = req.params;
    const { title, description } = req.body;

    console.log(
      `Updating content ${contentId} in module ${moduleId} for course: ${courseId}`
    );

    // Check if teacher is authorized to modify this course
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    });

    if (!course) {
      console.log("Course not found or teacher not authorized");
      return next(new ErrorHandler("Course not found or unauthorized", 404));
    }

    // Find CourseSyllabus
    const syllabus = await CourseSyllabus.findOne({ course: courseId }).session(
      session
    );
    if (!syllabus) {
      console.log(`No syllabus found for course: ${courseId}`);
      return next(new ErrorHandler("No syllabus found for this course", 404));
    }

    // Find specific module
    const module = syllabus.modules.id(moduleId);
    if (!module) {
      console.log(`Module not found: ${moduleId}`);
      return next(new ErrorHandler("Module not found", 404));
    }

    // Find content item
    if (!module.contentItems) {
      console.log("No content items found in this module");
      return next(
        new ErrorHandler("No content items found in this module", 404)
      );
    }

    const contentIndex = module.contentItems.findIndex(
      (item) => item._id.toString() === contentId
    );

    if (contentIndex === -1) {
      console.log(`Content item not found: ${contentId}`);
      return next(new ErrorHandler("Content item not found", 404));
    }

    const contentItem = module.contentItems[contentIndex];

    // Update basic fields
    if (title) contentItem.title = title;
    if (description !== undefined) contentItem.description = description;
    contentItem.updatedAt = new Date();

    // Update specific fields based on content type
    switch (contentItem.type) {
      case "file":
        // Handle file replacement if new file is uploaded
        if (req.files && req.files.file) {
          try {
            const allowedTypes = [
              "application/pdf",
              "application/vnd.ms-powerpoint",
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              "application/msword",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "image/jpeg",
              "image/png",
              "image/gif",
            ];

            const { filesArray, uploadedFiles } = await handleFileUploads(
              req.files.file,
              allowedTypes,
              "syllabus-files",
              next
            );

            const file = filesArray[0];
            const uploadedFile = uploadedFiles[0];

            // Delete old file from Azure if it exists
            if (contentItem.fileKey) {
              try {
                console.log(`Deleting file from Azure: ${contentItem.fileKey}`);
                await deleteFileFromAzure(contentItem.fileKey);
                console.log("Old file deleted from Azure");
              } catch (azureError) {
                console.error("Error deleting file from Azure:", azureError);
                // Continue with update even if Azure deletion fails
              }
            }

            // Determine file type
            let fileType = "other";
            if (file.mimetype === "application/pdf") {
              fileType = "pdf";
            } else if (
              file.mimetype === "application/vnd.ms-powerpoint" ||
              file.mimetype ===
                "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            ) {
              fileType = "presentation";
            } else if (
              file.mimetype === "application/msword" ||
              file.mimetype ===
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ) {
              fileType = "document";
            } else if (file.mimetype.startsWith("image/")) {
              fileType = "image";
            }

            // Update file properties
            contentItem.fileType = fileType;
            contentItem.fileName = file.name;
            contentItem.fileUrl = uploadedFile.url;
            contentItem.fileKey = uploadedFile.key;
          } catch (uploadError) {
            console.error("Error handling file upload:", uploadError);
            return next(
              new ErrorHandler(
                uploadError.message || "Failed to upload file",
                uploadError.statusCode || 500
              )
            );
          }
        }
        break;

      case "link":
        // Update link URL
        const { url } = req.body;
        if (url) {
          contentItem.url = url;
        }
        break;

      case "video":
        // Update video details
        const { videoUrl, videoProvider } = req.body;
        if (videoUrl) {
          contentItem.videoUrl = videoUrl;
        }
        if (videoProvider) {
          contentItem.videoProvider = videoProvider;
        }

        // If video file is uploaded instead of URL
        if (req.files && req.files.videoFile) {
          try {
            const allowedTypes = ["video/mp4", "video/webm", "video/ogg"];

            const { filesArray, uploadedFiles } = await handleFileUploads(
              req.files.videoFile,
              allowedTypes,
              "syllabus-videos",
              next
            );

            const uploadedFile = uploadedFiles[0];

            // Delete old video from Azure if it exists
            if (contentItem.videoKey) {
              try {
                console.log(
                  `Deleting video from Azure: ${contentItem.videoKey}`
                );
                await deleteFileFromAzure(contentItem.videoKey);
                console.log("Old video deleted from Azure");
              } catch (azureError) {
                console.error("Error deleting video from Azure:", azureError);
                // Continue with update even if Azure deletion fails
              }
            }

            // Override videoUrl with the uploaded file URL
            contentItem.videoUrl = uploadedFile.url;
            contentItem.videoKey = uploadedFile.key;
          } catch (uploadError) {
            console.error("Error handling video upload:", uploadError);
            return next(
              new ErrorHandler(
                uploadError.message || "Failed to upload video",
                uploadError.statusCode || 500
              )
            );
          }
        }
        break;

      case "text":
        // Update text content
        const { content } = req.body;
        if (content) {
          contentItem.content = content;
        }
        break;
    }

    // Update the item in the array
    module.contentItems[contentIndex] = contentItem;

    console.log("Saving updated syllabus");
    await syllabus.save({ session });
    console.log("Syllabus updated with modified content item");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(200).json({
      success: true,
      message: "Content item updated successfully",
      contentItem: module.contentItems[contentIndex],
    });
  } catch (error) {
    console.log(`Error in updateContentItem: ${error.message}`);
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

// Delete content item (keeping existing functionality)
exports.deleteContentItem = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteContentItem: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { courseId, moduleId, contentId } = req.params;

    console.log(
      `Deleting content ${contentId} from module ${moduleId} for course: ${courseId}`
    );

    // Check if teacher is authorized to modify this course
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    });

    if (!course) {
      console.log("Course not found or teacher not authorized");
      return next(new ErrorHandler("Course not found or unauthorized", 404));
    }

    // Find CourseSyllabus
    const syllabus = await CourseSyllabus.findOne({ course: courseId }).session(
      session
    );
    if (!syllabus) {
      console.log(`No syllabus found for course: ${courseId}`);
      return next(new ErrorHandler("No syllabus found for this course", 404));
    }

    // Find specific module
    const module = syllabus.modules.id(moduleId);
    if (!module) {
      console.log(`Module not found: ${moduleId}`);
      return next(new ErrorHandler("Module not found", 404));
    }

    // Find the content item
    if (!module.contentItems) {
      console.log("No content items found in this module");
      return next(
        new ErrorHandler("No content items found in this module", 404)
      );
    }

    const contentIndex = module.contentItems.findIndex(
      (item) => item._id.toString() === contentId
    );

    if (contentIndex === -1) {
      console.log(`Content item not found: ${contentId}`);
      return next(new ErrorHandler("Content item not found", 404));
    }

    const contentItem = module.contentItems[contentIndex];

    // Delete file from Azure if it's a file or video
    if (
      (contentItem.type === "file" && contentItem.fileKey) ||
      (contentItem.type === "video" && contentItem.videoKey)
    ) {
      const fileKey = contentItem.fileKey || contentItem.videoKey;
      try {
        console.log(`Deleting file from Azure: ${fileKey}`);
        await deleteFileFromAzure(fileKey);
        console.log("File deleted from Azure");
      } catch (azureError) {
        console.error("Error deleting file from Azure:", azureError);
        // Continue with the database deletion even if Azure deletion fails
      }
    }

    // Remove content item from module
    module.contentItems.splice(contentIndex, 1);

    console.log("Saving updated syllabus");
    await syllabus.save({ session });
    console.log("Content item removed from module");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(200).json({
      success: true,
      message: "Content item deleted successfully",
      courseId: courseId,
      moduleId: moduleId,
      contentId: contentId,
    });
  } catch (error) {
    console.log(`Error in deleteContentItem: ${error.message}`);

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
