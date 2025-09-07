const mongoose = require("mongoose");
const Discussion = require("../models/Discussion");
const Course = require("../models/Course");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const { ErrorHandler } = require("../middleware/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const {
  uploadFileToAzure,
  deleteFileFromAzure,
} = require("../utils/azureConfig");

// Helper function for uploading files to Azure
const uploadFileToAzureStorage = async (file, path) => {
  console.log("Uploading file to Azure");
  return new Promise((resolve, reject) => {
    const fileContent = file.data;
    if (!fileContent) {
      console.log("No file content found");
      return reject(new Error("No file content found"));
    }

    uploadFileToAzure(file, path)
      .then((result) => {
        console.log("File uploaded successfully");
        resolve({
          url: result.url,
          key: result.key,
        });
      })
      .catch((err) => {
        console.log("Azure upload error:", err);
        reject(err);
      });
  });
};

// Helper function to delete files from Azure
const deleteFileFromAzureStorage = async (fileKey) => {
  console.log("Deleting file from Azure:", fileKey);
  return new Promise((resolve, reject) => {
    if (!fileKey) {
      console.log("No file key provided");
      return resolve({ message: "No file key provided" });
    }

    deleteFileFromAzure(fileKey)
      .then((result) => {
        console.log("File deleted successfully from Azure");
        resolve(result);
      })
      .catch((err) => {
        console.log("Azure delete error:", err);
        reject(err);
      });
  });
};

// Create a new discussion - CORRECTED for both teacher and student access
exports.createDiscussion = catchAsyncErrors(async (req, res, next) => {
  console.log("createDiscussion: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { title, content } = req.body;
    let { courseId } = req.params;

    // Determine discussion type based on route and courseId
    const type = courseId ? "course" : "teacher";

    // Validate inputs
    if (!title || !content) {
      console.log("Missing required fields");
      return next(new ErrorHandler("Title and content are required", 400));
    }

    // CORRECTED: Handle both teacher and student creating discussions
    let authorProfile = null;

    if (req.user.role === "teacher") {
      // Find the teacher
      authorProfile = await Teacher.findOne({ user: req.user._id }).session(
        session
      );
      if (!authorProfile) {
        console.log("Teacher not found");
        return next(new ErrorHandler("Teacher profile not found", 404));
      }

      // For course discussions, validate teacher has access to course
      if (type === "course") {
        if (!courseId) {
          console.log("Course ID required for course discussions");
          return next(
            new ErrorHandler(
              "Course ID is required for course discussions",
              400
            )
          );
        }

        const course = await Course.findOne({
          _id: courseId,
          teacher: authorProfile._id,
        }).session(session);

        if (!course) {
          console.log("Course not found or teacher doesn't have access");
          return next(
            new ErrorHandler("Course not found or unauthorized", 404)
          );
        }
      }
    } else if (req.user.role === "student") {
      // Find the student
      authorProfile = await Student.findOne({ user: req.user._id }).session(
        session
      );
      if (!authorProfile) {
        console.log("Student not found");
        return next(new ErrorHandler("Student profile not found", 404));
      }

      // Students can only create course discussions, not teacher-only discussions
      if (type !== "course") {
        console.log("Students can only create course discussions");
        return next(
          new ErrorHandler("Students can only create course discussions", 403)
        );
      }

      // Validate student is enrolled in the course
      if (!courseId) {
        console.log("Course ID required for course discussions");
        return next(
          new ErrorHandler("Course ID is required for course discussions", 400)
        );
      }

      const isEnrolled = authorProfile.courses.some(
        (id) => id.toString() === courseId
      );
      if (!isEnrolled) {
        console.log("Student not enrolled in course");
        return next(
          new ErrorHandler("You are not enrolled in this course", 403)
        );
      }

      // Verify the course exists
      const course = await Course.findById(courseId).session(session);
      if (!course) {
        console.log("Course not found");
        return next(new ErrorHandler("Course not found", 404));
      }
    } else {
      return next(new ErrorHandler("Invalid user role", 403));
    }

    // Create discussion object
    const discussion = new Discussion({
      title,
      content,
      author: req.user._id,
      type,
      course: type === "course" ? courseId : null,
      attachments: [],
    });

    // Handle file uploads if any
    if (req.files && req.files.attachments) {
      try {
        let attachmentsArray = Array.isArray(req.files.attachments)
          ? req.files.attachments
          : [req.files.attachments];

        console.log(`Found ${attachmentsArray.length} attachments`);

        // Validate file types and sizes
        for (const file of attachmentsArray) {
          console.log(`Validating file: ${file.name}, size: ${file.size}`);

          // 5MB limit
          if (file.size > 5 * 1024 * 1024) {
            console.log(`File too large: ${file.size} bytes`);
            return next(
              new ErrorHandler(
                "File too large. Maximum size allowed is 5MB",
                400
              )
            );
          }
        }

        // Upload files to Azure
        const uploadPromises = attachmentsArray.map((file) =>
          uploadFileToAzureStorage(file, "discussion-attachments")
        );

        const uploadedFiles = await Promise.all(uploadPromises);
        console.log(`Successfully uploaded ${uploadedFiles.length} files`);

        // Add attachments to discussion
        discussion.attachments = uploadedFiles.map((file) => ({
          fileUrl: file.url,
          fileKey: file.key,
          fileName: file.key.split("/").pop(),
        }));
      } catch (uploadError) {
        console.error("Error uploading files:", uploadError);
        return next(
          new ErrorHandler(
            uploadError.message || "Failed to upload files",
            uploadError.statusCode || 500
          )
        );
      }
    }

    // Save discussion
    await discussion.save({ session });
    console.log(`Discussion saved with ID: ${discussion._id}`);

    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(201).json({
      success: true,
      message: "Discussion created successfully",
      discussion,
    });
  } catch (error) {
    console.log(`Error in createDiscussion: ${error.message}`);

    if (transactionStarted) {
      try {
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

// Get all teacher discussions - CORRECTED to allow students to view
exports.getTeacherDiscussions = catchAsyncErrors(async (req, res, next) => {
  console.log("getTeacherDiscussions: Started");

  try {
    // Only teachers can access teacher-only discussions
    if (req.user.role !== "teacher") {
      return next(
        new ErrorHandler("Only teachers can access teacher discussions", 403)
      );
    }

    const discussions = await Discussion.find({ type: "teacher" })
      .populate({
        path: "author",
        select: "name email mobileNo gender",
      })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: discussions.length,
      discussions,
    });
  } catch (error) {
    console.log(`Error in getTeacherDiscussions: ${error.message}`);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Get course discussions - CORRECTED for proper access control
exports.getCourseDiscussions = catchAsyncErrors(async (req, res, next) => {
  console.log("getCourseDiscussions: Started");
  const { courseId } = req.params;

  try {
    // Verify user has access to this course based on their role
    if (req.user.role === "teacher") {
      const teacher = await Teacher.findOne({ user: req.user._id });
      if (!teacher) {
        return next(new ErrorHandler("Teacher profile not found", 404));
      }

      const course = await Course.findOne({
        _id: courseId,
        teacher: teacher._id,
      });

      if (!course) {
        return next(new ErrorHandler("Course not found or unauthorized", 404));
      }
    } else if (req.user.role === "student") {
      const student = await Student.findOne({ user: req.user._id });
      if (!student) {
        return next(new ErrorHandler("Student profile not found", 404));
      }

      const isEnrolled = student.courses.some(
        (id) => id.toString() === courseId
      );
      if (!isEnrolled) {
        return next(
          new ErrorHandler("You are not enrolled in this course", 403)
        );
      }
    } else {
      return next(new ErrorHandler("Invalid user role", 403));
    }

    // Get discussions for this course
    const discussions = await Discussion.find({
      course: courseId,
      type: "course",
    })
      .populate({
        path: "author",
        select: "name email mobileNo gender ageAsOn2025",
      })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: discussions.length,
      discussions,
    });
  } catch (error) {
    console.log(`Error in getCourseDiscussions: ${error.message}`);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Get a single discussion by ID
exports.getDiscussionById = catchAsyncErrors(async (req, res, next) => {
  console.log("getDiscussionById: Started");
  const { discussionId } = req.params;

  try {
    // Find the discussion and populate author info for the discussion and all comments
    const discussion = await Discussion.findById(discussionId)
      .populate({
        path: "author",
        select: "name email mobileNo gender ageAsOn2025 fullPermanentAddress",
      })
      .populate({
        path: "comments.author",
        select: "name email mobileNo gender",
      })
      .populate({
        path: "comments.replies.author",
        select: "name email mobileNo gender",
      });

    if (!discussion) {
      return next(new ErrorHandler("Discussion not found", 404));
    }

    // If it's a course discussion, verify user has access
    if (discussion.type === "course") {
      if (req.user.role === "teacher") {
        const teacher = await Teacher.findOne({ user: req.user._id });
        if (!teacher) {
          return next(new ErrorHandler("Teacher not found", 404));
        }

        if (discussion.course) {
          const course = await Course.findOne({
            _id: discussion.course,
            teacher: teacher._id,
          });

          if (!course) {
            return next(new ErrorHandler("Unauthorized access", 403));
          }
        }
      } else if (req.user.role === "student") {
        const student = await Student.findOne({ user: req.user._id });
        if (!student) {
          return next(new ErrorHandler("Student not found", 404));
        }

        if (discussion.course) {
          const isEnrolled = student.courses.some(
            (id) => id.toString() === discussion.course.toString()
          );
          if (!isEnrolled) {
            return next(
              new ErrorHandler("You are not enrolled in this course", 403)
            );
          }
        }
      }
    }
    // If it's a teacher discussion, verify user is a teacher
    else if (discussion.type === "teacher" && req.user.role !== "teacher") {
      return next(new ErrorHandler("Unauthorized access", 403));
    }

    // Increment view count
    discussion.viewCount += 1;
    await discussion.save();

    res.status(200).json({
      success: true,
      discussion,
    });
  } catch (error) {
    console.log(`Error in getDiscussionById: ${error.message}`);
    return next(new ErrorHandler(error.message, 500));
  }
});

// CORRECTED: Add comment function with proper role-based access
exports.addComment = catchAsyncErrors(async (req, res, next) => {
  console.log("addComment: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const { discussionId } = req.params;
    const { content } = req.body;

    if (!content) {
      return next(new ErrorHandler("Comment content is required", 400));
    }

    const discussion = await Discussion.findById(discussionId).session(session);
    if (!discussion) {
      return next(new ErrorHandler("Discussion not found", 404));
    }

    // CORRECTED: Verify user has permission to comment based on role
    if (discussion.type === "teacher") {
      // Only teachers can comment on teacher discussions
      if (req.user.role !== "teacher") {
        return next(
          new ErrorHandler(
            "Only teachers can comment on teacher discussions",
            403
          )
        );
      }
    } else if (discussion.type === "course") {
      // Both teachers and students can comment on course discussions, but need proper access
      if (req.user.role === "teacher") {
        const teacher = await Teacher.findOne({ user: req.user._id });
        if (!teacher) {
          return next(new ErrorHandler("Teacher profile not found", 404));
        }

        if (discussion.course) {
          const course = await Course.findOne({
            _id: discussion.course,
            teacher: teacher._id,
          });

          if (!course) {
            return next(
              new ErrorHandler("Unauthorized access to this course", 403)
            );
          }
        }
      } else if (req.user.role === "student") {
        const student = await Student.findOne({ user: req.user._id });
        if (!student) {
          return next(new ErrorHandler("Student profile not found", 404));
        }

        if (discussion.course) {
          const isEnrolled = student.courses.some(
            (id) => id.toString() === discussion.course.toString()
          );
          if (!isEnrolled) {
            return next(
              new ErrorHandler("You are not enrolled in this course", 403)
            );
          }
        }
      } else {
        return next(new ErrorHandler("Invalid user role", 403));
      }
    }

    // Create comment object
    const comment = {
      content,
      author: req.user._id,
      parentComment: null,
      attachments: [],
      replies: [],
    };

    // Handle file uploads if any
    if (req.files && req.files.attachments) {
      try {
        let attachmentsArray = Array.isArray(req.files.attachments)
          ? req.files.attachments
          : [req.files.attachments];

        console.log(`Found ${attachmentsArray.length} attachments for comment`);

        // Validate file sizes (5MB limit)
        for (const file of attachmentsArray) {
          if (file.size > 5 * 1024 * 1024) {
            return next(
              new ErrorHandler(
                "File too large. Maximum size allowed is 5MB",
                400
              )
            );
          }
        }

        // Upload files to Azure
        const uploadPromises = attachmentsArray.map((file) =>
          uploadFileToAzureStorage(file, "comment-attachments")
        );

        const uploadedFiles = await Promise.all(uploadPromises);

        // Add attachments to comment
        comment.attachments = uploadedFiles.map((file) => ({
          fileUrl: file.url,
          fileKey: file.key,
          fileName: file.key.split("/").pop(),
        }));
      } catch (uploadError) {
        console.error("Error uploading comment attachments:", uploadError);
        return next(new ErrorHandler("Failed to upload files", 500));
      }
    }

    // Add comment to discussion
    discussion.comments.push(comment);
    await discussion.save({ session });

    await session.commitTransaction();
    transactionStarted = false;

    // Populate author information for response
    await discussion.populate({
      path: "comments.author",
      select: "name email mobileNo gender",
      model: "User",
    });

    const addedComment = discussion.comments[discussion.comments.length - 1];

    res.status(201).json({
      success: true,
      message: "Comment added successfully",
      comment: addedComment,
    });
  } catch (error) {
    console.log(`Error in addComment: ${error.message}`);

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

// Add reply to a comment (nested comment)
exports.addReplyToComment = catchAsyncErrors(async (req, res, next) => {
  console.log("addReplyToComment: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const { discussionId, commentId } = req.params;
    const { content } = req.body;

    if (!content) {
      return next(new ErrorHandler("Reply content is required", 400));
    }

    const discussion = await Discussion.findById(discussionId).session(session);
    if (!discussion) {
      return next(new ErrorHandler("Discussion not found", 404));
    }

    // Verify user has permission to comment (same as for regular comments)
    if (discussion.type === "teacher" && req.user.role !== "teacher") {
      return next(
        new ErrorHandler(
          "Only teachers can comment on teacher discussions",
          403
        )
      );
    } else if (discussion.type === "course") {
      if (req.user.role === "teacher") {
        const teacher = await Teacher.findOne({ user: req.user._id });
        if (!teacher) {
          return next(new ErrorHandler("Teacher not found", 404));
        }

        if (discussion.course) {
          const course = await Course.findOne({
            _id: discussion.course,
            teacher: teacher._id,
          });

          if (!course) {
            return next(new ErrorHandler("Unauthorized access", 403));
          }
        }
      } else if (req.user.role === "student") {
        const student = await Student.findOne({ user: req.user._id });
        if (!student) {
          return next(new ErrorHandler("Student not found", 404));
        }

        if (discussion.course) {
          const isEnrolled = student.courses.some(
            (id) => id.toString() === discussion.course.toString()
          );
          if (!isEnrolled) {
            return next(
              new ErrorHandler("You are not enrolled in this course", 403)
            );
          }
        }
      }
    }

    // Find the comment to reply to
    const findCommentById = (comments, id) => {
      for (let i = 0; i < comments.length; i++) {
        if (comments[i]._id.toString() === id) {
          return { comment: comments[i], path: `comments.${i}` };
        }
        if (comments[i].replies && comments[i].replies.length > 0) {
          for (let j = 0; j < comments[i].replies.length; j++) {
            if (comments[i].replies[j]._id.toString() === id) {
              return {
                comment: comments[i].replies[j],
                path: `comments.${i}.replies.${j}`,
              };
            }
          }
        }
      }
      return null;
    };

    const result = findCommentById(discussion.comments, commentId);
    if (!result) {
      return next(new ErrorHandler("Comment not found", 404));
    }

    // Create reply object
    const reply = {
      content,
      author: req.user._id,
      parentComment: commentId,
      attachments: [],
    };

    // Handle file uploads if any
    if (req.files && req.files.attachments) {
      try {
        let attachmentsArray = Array.isArray(req.files.attachments)
          ? req.files.attachments
          : [req.files.attachments];

        // Validate file sizes (5MB limit)
        for (const file of attachmentsArray) {
          if (file.size > 5 * 1024 * 1024) {
            return next(
              new ErrorHandler(
                "File too large. Maximum size allowed is 5MB",
                400
              )
            );
          }
        }

        // Upload files to Azure
        const uploadPromises = attachmentsArray.map((file) =>
          uploadFileToAzureStorage(file, "comment-attachments")
        );

        const uploadedFiles = await Promise.all(uploadPromises);

        // Add attachments to reply
        reply.attachments = uploadedFiles.map((file) => ({
          fileUrl: file.url,
          fileKey: file.key,
          fileName: file.key.split("/").pop(),
        }));
      } catch (uploadError) {
        console.error("Error uploading reply attachments:", uploadError);
        return next(new ErrorHandler("Failed to upload files", 500));
      }
    }

    // Add reply to comment
    result.comment.replies = result.comment.replies || [];
    result.comment.replies.push(reply);
    await discussion.save({ session });

    await session.commitTransaction();
    transactionStarted = false;

    res.status(201).json({
      success: true,
      message: "Reply added successfully",
      reply: reply,
    });
  } catch (error) {
    console.log(`Error in addReplyToComment: ${error.message}`);

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

// Update a discussion
exports.updateDiscussion = catchAsyncErrors(async (req, res, next) => {
  console.log("updateDiscussion: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const { discussionId } = req.params;
    const { title, content } = req.body;

    // Find the discussion
    const discussion = await Discussion.findById(discussionId).session(session);
    if (!discussion) {
      return next(new ErrorHandler("Discussion not found", 404));
    }

    // Verify the user is the author of the discussion
    if (discussion.author.toString() !== req.user._id.toString()) {
      return next(
        new ErrorHandler("You can only update your own discussions", 403)
      );
    }

    // Update discussion fields
    if (title) discussion.title = title;
    if (content) discussion.content = content;

    await discussion.save({ session });

    await session.commitTransaction();
    transactionStarted = false;

    res.status(200).json({
      success: true,
      message: "Discussion updated successfully",
      discussion,
    });
  } catch (error) {
    console.log(`Error in updateDiscussion: ${error.message}`);

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

// Update a comment
exports.updateComment = catchAsyncErrors(async (req, res, next) => {
  console.log("updateComment: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const { discussionId, commentId } = req.params;
    const { content } = req.body;

    if (!content) {
      return next(new ErrorHandler("Comment content is required", 400));
    }

    // Find the discussion
    const discussion = await Discussion.findById(discussionId).session(session);
    if (!discussion) {
      return next(new ErrorHandler("Discussion not found", 404));
    }

    // Find the comment
    const findCommentById = (comments, id) => {
      for (let i = 0; i < comments.length; i++) {
        if (comments[i]._id.toString() === id) {
          return { comment: comments[i], path: `comments.${i}` };
        }
        if (comments[i].replies && comments[i].replies.length > 0) {
          for (let j = 0; j < comments[i].replies.length; j++) {
            if (comments[i].replies[j]._id.toString() === id) {
              return {
                comment: comments[i].replies[j],
                path: `comments.${i}.replies.${j}`,
              };
            }
          }
        }
      }
      return null;
    };

    const result = findCommentById(discussion.comments, commentId);
    if (!result) {
      return next(new ErrorHandler("Comment not found", 404));
    }

    // Verify the user is the author of the comment
    if (result.comment.author.toString() !== req.user._id.toString()) {
      return next(
        new ErrorHandler("You can only update your own comments", 403)
      );
    }

    // Update the comment
    result.comment.content = content;

    await discussion.save({ session });

    await session.commitTransaction();
    transactionStarted = false;

    res.status(200).json({
      success: true,
      message: "Comment updated successfully",
      comment: result.comment,
    });
  } catch (error) {
    console.log(`Error in updateComment: ${error.message}`);

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

// Delete a comment (soft delete)
exports.deleteComment = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteComment: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const { discussionId, commentId } = req.params;

    // Find the discussion
    const discussion = await Discussion.findById(discussionId).session(session);
    if (!discussion) {
      return next(new ErrorHandler("Discussion not found", 404));
    }

    // Find the comment
    const findCommentById = (comments, id) => {
      for (let i = 0; i < comments.length; i++) {
        if (comments[i]._id.toString() === id) {
          return { comment: comments[i], path: `comments.${i}` };
        }
        if (comments[i].replies && comments[i].replies.length > 0) {
          for (let j = 0; j < comments[i].replies.length; j++) {
            if (comments[i].replies[j]._id.toString() === id) {
              return {
                comment: comments[i].replies[j],
                path: `comments.${i}.replies.${j}`,
              };
            }
          }
        }
      }
      return null;
    };

    const result = findCommentById(discussion.comments, commentId);
    if (!result) {
      return next(new ErrorHandler("Comment not found", 404));
    }

    // Verify permissions
    if (
      result.comment.author.toString() !== req.user._id.toString() &&
      discussion.author.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return next(
        new ErrorHandler("You can only delete your own comments", 403)
      );
    }

    // Soft delete the comment
    result.comment.isDeleted = true;
    result.comment.content = "This comment has been deleted";

    await discussion.save({ session });

    await session.commitTransaction();
    transactionStarted = false;

    res.status(200).json({
      success: true,
      message: "Comment deleted successfully",
    });
  } catch (error) {
    console.log(`Error in deleteComment: ${error.message}`);

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

// Delete a discussion
exports.deleteDiscussion = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteDiscussion: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const { discussionId } = req.params;

    // Find the discussion
    const discussion = await Discussion.findById(discussionId).session(session);
    if (!discussion) {
      return next(new ErrorHandler("Discussion not found", 404));
    }

    // Verify the user is the author of the discussion or an admin
    if (
      discussion.author.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return next(
        new ErrorHandler("You can only delete your own discussions", 403)
      );
    }

    // Delete the discussion
    await Discussion.findByIdAndDelete(discussionId).session(session);

    await session.commitTransaction();
    transactionStarted = false;

    res.status(200).json({
      success: true,
      message: "Discussion deleted successfully",
    });
  } catch (error) {
    console.log(`Error in deleteDiscussion: ${error.message}`);

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

// Search discussions
exports.searchDiscussions = catchAsyncErrors(async (req, res, next) => {
  console.log("searchDiscussions: Started");

  try {
    const { query, type, courseId } = req.query;

    if (!query) {
      return next(new ErrorHandler("Search query is required", 400));
    }

    // Build search criteria
    const searchCriteria = {
      $or: [
        { title: { $regex: query, $options: "i" } },
        { content: { $regex: query, $options: "i" } },
      ],
    };

    // Add type filter if provided
    if (type && ["teacher", "course"].includes(type)) {
      searchCriteria.type = type;
    }

    // Add course filter if provided
    if (courseId) {
      searchCriteria.course = courseId;
    }

    // For teacher-only discussions, ensure user is a teacher
    if (type === "teacher" && req.user.role !== "teacher") {
      return next(new ErrorHandler("Unauthorized access", 403));
    }

    // Perform the search
    const discussions = await Discussion.find(searchCriteria)
      .populate({
        path: "author",
        select: "name email mobileNo gender ageAsOn2025",
      })
      .sort({ createdAt: -1 })
      .limit(20);

    res.status(200).json({
      success: true,
      count: discussions.length,
      discussions,
    });
  } catch (error) {
    console.log(`Error in searchDiscussions: ${error.message}`);
    return next(new ErrorHandler(error.message, 500));
  }
});

module.exports = exports;
