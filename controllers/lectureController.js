const Course = require("../models/Course");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const Lecture = require("../models/Lecture");
const CourseSyllabus = require("../models/CourseSyllabus");
const mongoose = require("mongoose");
const {
  uploadFileToAzure,
  deleteFileFromAzure,
} = require("../utils/azureConfig");

// Better logging setup
const logger = {
  info: (message) => console.log(`[INFO] ${message}`),
  error: (message, error) => console.error(`[ERROR] ${message}`, error),
};

// Helper function to check if error is transient and retryable
const isTransientError = (error) => {
  return (
    error.code === 251 || // NoSuchTransaction
    error.codeName === "NoSuchTransaction" ||
    error.errorLabels?.includes("TransientTransactionError") ||
    error.name === "MongoNetworkError"
  );
};

// Helper function to perform database operations with retry logic
const withRetry = async (operation, maxRetries = 3, baseDelay = 1000) => {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (isTransientError(error) && attempt < maxRetries) {
        logger.info(
          `Retrying operation (attempt ${
            attempt + 1
          }/${maxRetries}) due to transient error: ${error.message}`
        );
        // Exponential backoff
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // If not transient or max retries reached, throw the error
      throw error;
    }
  }

  throw lastError;
};

// Helper function to validate video file
const validateVideoFile = (videoFile) => {
  // Check if file exists
  if (!videoFile) {
    throw new Error("Video file is required");
  }

  // Check file type
  if (!videoFile.mimetype || !videoFile.mimetype.startsWith("video/")) {
    throw new Error("Uploaded file must be a video");
  }

  // Validate file size (500MB limit)
  const maxSize = 500 * 1024 * 1024; // 500MB
  if (videoFile.size > maxSize) {
    throw new Error(
      `Video file too large. Maximum size is ${maxSize / (1024 * 1024)}MB`
    );
  }

  // Check if file has data
  if (!videoFile.data || videoFile.data.length === 0) {
    throw new Error("Video file appears to be empty");
  }

  return true;
};

// Helper function to generate Azure path
const generateAzurePath = (courseId, moduleId, fileName) => {
  // Sanitize filename to remove special characters
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `lectures/course-${courseId}/module-${moduleId}/${sanitizedFileName}`;
};

// Create a new lecture for a specific module
const createLectureForModule = async function (req, res) {
  let uploadedVideoKey = null;

  try {
    logger.info(
      `Creating lecture for course ID: ${req.params.courseId}, module ID: ${req.params.moduleId}`
    );

    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      logger.error(`Teacher not found for user ID: ${req.user.id}`);
      return res.status(404).json({ error: "Teacher not found" });
    }

    const { courseId, moduleId } = req.params;

    // Verify course ownership (outside transaction)
    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    });

    if (!course) {
      logger.error(`Course not found with ID: ${courseId}`);
      return res.status(404).json({ error: "Course not found" });
    }

    // Find the syllabus and module (outside transaction)
    const syllabus = await CourseSyllabus.findOne({ course: courseId });
    if (!syllabus) {
      logger.error(`Course syllabus not found for course: ${courseId}`);
      return res.status(404).json({ error: "Course syllabus not found" });
    }

    const module = syllabus.modules.id(moduleId);
    if (!module) {
      logger.error(`Module not found with ID: ${moduleId}`);
      return res.status(404).json({ error: "Module not found" });
    }

    // Validate input
    if (!req.body.title || req.body.title.trim() === "") {
      return res.status(400).json({ error: "Lecture title is required" });
    }

    // Check if video file was uploaded
    if (!req.files || !req.files.video) {
      return res.status(400).json({ error: "Video file is required" });
    }

    const videoFile = req.files.video;
    logger.info(
      `Processing video file: ${videoFile.name}, size: ${videoFile.size} bytes`
    );

    // Validate video file
    try {
      validateVideoFile(videoFile);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    // For large files, send immediate response and process in background
    const isLargeFile = videoFile.size > 50 * 1024 * 1024; // 50MB threshold

    if (isLargeFile) {
      logger.info("Large file detected, processing in background");

      // Send immediate response for large files
      res.status(202).json({
        success: true,
        message: "Large video upload initiated. Processing in background...",
        status: "processing",
        fileSize: videoFile.size,
        fileName: videoFile.name,
        estimatedTime: "This may take several minutes depending on file size",
      });

      // Process large file upload in background
      processLargeVideoUpload(
        videoFile,
        courseId,
        moduleId,
        course,
        module,
        req.body,
        teacher._id
      ).catch((error) => {
        logger.error("Background upload failed:", error);
        // Here you could implement notification system to inform user of failure
      });

      return;
    }

    // For smaller files, process synchronously
    logger.info("Small file detected, processing synchronously");

    // STEP 1: Upload video to Azure FIRST (outside transaction)
    logger.info("Uploading video to Azure Blob Storage");

    // Generate Azure path with original filename
    const azurePath = generateAzurePath(courseId, moduleId, videoFile.name);

    let uploadResult;
    try {
      uploadResult = await uploadFileToAzure(videoFile, azurePath);
      uploadedVideoKey = uploadResult.key; // Store for cleanup if needed
      logger.info(`Video uploaded successfully: ${uploadResult.key}`);
      logger.info(`Video URL: ${uploadResult.url}`);
    } catch (uploadError) {
      logger.error("Video upload failed:", uploadError);
      return res.status(500).json({
        error: "Failed to upload video",
        details: uploadError.message,
      });
    }

    // STEP 2: Quick database operations without long transaction
    const result = await createLectureRecord(
      uploadResult,
      videoFile,
      courseId,
      moduleId,
      course,
      module,
      req.body
    );

    logger.info(
      `Successfully created lecture ID: ${result._id} for module: ${moduleId}`
    );

    // Return success response with lecture details
    res.status(201).json({
      success: true,
      message: "Lecture created successfully",
      lecture: {
        _id: result._id,
        title: result.title,
        content: result.content,
        videoUrl: result.videoUrl,
        originalVideoName: videoFile.name,
        course: result.course,
        syllabusModule: result.syllabusModule,
        moduleNumber: result.moduleNumber,
        lectureOrder: result.lectureOrder,
        isReviewed: result.isReviewed,
        reviewDeadline: result.reviewDeadline,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      },
    });
  } catch (error) {
    logger.error("Error in createLectureForModule:", error);

    // Clean up uploaded video if database operation failed
    if (uploadedVideoKey) {
      try {
        await deleteFileFromAzure(uploadedVideoKey);
        logger.info(
          `Cleaned up uploaded video after error: ${uploadedVideoKey}`
        );
      } catch (cleanupError) {
        logger.error("Error cleaning up uploaded video:", cleanupError);
      }
    }

    res.status(500).json({
      error: error.message,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

// Helper function to create lecture record in database
const createLectureRecord = async (
  uploadResult,
  videoFile,
  courseId,
  moduleId,
  course,
  module,
  body
) => {
  // Use shorter transaction timeout and simpler operations
  const session = await mongoose.startSession();

  try {
    await session.startTransaction({
      readConcern: { level: "majority" },
      writeConcern: { w: "majority", wtimeout: 10000 }, // 10 second timeout
    });

    logger.info("Database transaction started for lecture creation");

    // Get the next lecture order for this module (simplified query)
    const lectureCount = await Lecture.countDocuments({
      course: courseId,
      syllabusModule: moduleId,
    }).session(session);

    const nextOrder = lectureCount + 1;
    logger.info(`Next lecture order for module ${moduleId}: ${nextOrder}`);

    // Create the lecture with video info
    const lectureData = {
      title: body.title.trim(),
      content: body.content || "",
      videoUrl: uploadResult.url,
      videoKey: uploadResult.key,
      originalVideoName: videoFile.name,
      videoSize: uploadResult.size || videoFile.size,
      videoContentType: uploadResult.contentType || videoFile.mimetype,
      course: course._id,
      syllabusModule: moduleId,
      moduleNumber: module.moduleNumber,
      lectureOrder: nextOrder,
      isReviewed: body.isReviewed || false,
      uploadMetadata: {
        uploadDate: new Date(),
        azureRequestId: uploadResult.requestId,
        azureETag: uploadResult.etag,
      },
    };

    // Set review deadline if provided
    if (body.reviewDeadline) {
      lectureData.reviewDeadline = new Date(body.reviewDeadline);
    }

    const lecture = new Lecture(lectureData);
    await lecture.save({ session });
    logger.info(`Lecture created with ID: ${lecture._id}`);

    // Update syllabus module with new lecture (single operation)
    await CourseSyllabus.findOneAndUpdate(
      {
        course: courseId,
        "modules._id": moduleId,
      },
      {
        $push: { "modules.$.lectures": lecture._id },
      },
      { session }
    );

    logger.info(
      `Lecture ${lecture._id} added to module ${moduleId} in syllabus`
    );

    await session.commitTransaction();
    logger.info("Database transaction committed successfully");

    return lecture;
  } catch (dbError) {
    try {
      await session.abortTransaction();
      logger.info("Database transaction aborted");
    } catch (abortError) {
      logger.error("Error aborting transaction:", abortError);
    }
    throw dbError;
  } finally {
    await session.endSession();
    logger.info("Database session ended");
  }
};

// Background processing function for large video uploads
const processLargeVideoUpload = async (
  videoFile,
  courseId,
  moduleId,
  course,
  module,
  body,
  teacherId
) => {
  let uploadedVideoKey = null;

  try {
    logger.info(`Starting background upload for large file: ${videoFile.name}`);

    // Generate Azure path with original filename
    const azurePath = generateAzurePath(courseId, moduleId, videoFile.name);

    // Upload to Azure (this can take a long time for large files)
    const uploadResult = await uploadFileToAzure(videoFile, azurePath);
    uploadedVideoKey = uploadResult.key;
    logger.info(`Large video uploaded successfully: ${uploadResult.key}`);

    // Create lecture record in database
    const lecture = await createLectureRecord(
      uploadResult,
      videoFile,
      courseId,
      moduleId,
      course,
      module,
      body
    );

    logger.info(
      `Background upload completed successfully. Lecture ID: ${lecture._id}`
    );

    // Here you could implement a notification system to inform the user
    // For example, using WebSockets, email, or updating a status table
  } catch (error) {
    logger.error("Background upload failed:", error);

    // Clean up uploaded video if database operation failed
    if (uploadedVideoKey) {
      try {
        await deleteFileFromAzure(uploadedVideoKey);
        logger.info(
          `Cleaned up video after background upload failure: ${uploadedVideoKey}`
        );
      } catch (cleanupError) {
        logger.error(
          "Error cleaning up video after background failure:",
          cleanupError
        );
      }
    }

    // Here you could implement error notification to user
    throw error;
  }
};

// Get all lectures for a specific module
const getModuleLectures = async function (req, res) {
  try {
    logger.info(
      `Fetching lectures for course ID: ${req.params.courseId}, module ID: ${req.params.moduleId}`
    );

    const { courseId, moduleId } = req.params;

    // Verify user access to course
    if (req.user.role === "teacher") {
      const teacher = await Teacher.findOne({ user: req.user.id });
      if (!teacher) {
        return res.status(404).json({ error: "Teacher not found" });
      }

      const course = await Course.findOne({
        _id: courseId,
        teacher: teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }
    } else if (req.user.role === "student") {
      const student = await Student.findOne({ user: req.user.id });
      if (!student) {
        return res.status(404).json({ error: "Student not found" });
      }

      if (!student.courses.includes(courseId)) {
        return res
          .status(403)
          .json({ error: "You are not enrolled in this course" });
      }
    }

    // Find lectures for this module
    const lectures = await Lecture.find({
      course: courseId,
      syllabusModule: moduleId,
      isActive: true,
    }).sort({ lectureOrder: 1 });

    // Check for lectures that have passed their review deadline
    const now = new Date();
    const updatePromises = lectures.map(async (lecture) => {
      if (
        !lecture.isReviewed &&
        lecture.reviewDeadline &&
        now >= lecture.reviewDeadline
      ) {
        lecture.isReviewed = true;
        await lecture.save();
      }
      return lecture;
    });

    await Promise.all(updatePromises);

    // Re-fetch lectures to get updated data
    const updatedLectures = await Lecture.find({
      course: courseId,
      syllabusModule: moduleId,
      isActive: true,
    }).sort({ lectureOrder: 1 });

    logger.info(
      `Found ${updatedLectures.length} lectures for module ${moduleId}`
    );

    res.json({
      success: true,
      moduleId,
      courseId,
      lectures: updatedLectures,
    });
  } catch (error) {
    logger.error("Error in getModuleLectures:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get all lectures for a course organized by modules
const getCourseModulesWithLectures = async function (req, res) {
  try {
    logger.info(
      `Fetching all modules with lectures for course ID: ${req.params.courseId}`
    );

    const { courseId } = req.params;

    // Verify user access to course
    if (req.user.role === "teacher") {
      const teacher = await Teacher.findOne({ user: req.user.id });
      if (!teacher) {
        return res.status(404).json({ error: "Teacher not found" });
      }

      const course = await Course.findOne({
        _id: courseId,
        teacher: teacher._id,
      });

      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }
    } else if (req.user.role === "student") {
      const student = await Student.findOne({ user: req.user.id });
      if (!student) {
        return res.status(404).json({ error: "Student not found" });
      }

      if (!student.courses.includes(courseId)) {
        return res
          .status(403)
          .json({ error: "You are not enrolled in this course" });
      }
    }

    // Get syllabus with modules
    const syllabus = await CourseSyllabus.findOne({ course: courseId });
    if (!syllabus) {
      return res.status(404).json({ error: "Course syllabus not found" });
    }

    // Get all lectures for this course
    const lectures = await Lecture.find({
      course: courseId,
      isActive: true,
    }).sort({ moduleNumber: 1, lectureOrder: 1 });

    // Check for lectures that have passed their review deadline
    const now = new Date();
    const updatePromises = lectures.map(async (lecture) => {
      if (
        !lecture.isReviewed &&
        lecture.reviewDeadline &&
        now >= lecture.reviewDeadline
      ) {
        lecture.isReviewed = true;
        await lecture.save();
      }
      return lecture;
    });

    await Promise.all(updatePromises);

    // Organize lectures by modules
    const modulesWithLectures = syllabus.modules.map((module) => {
      const moduleLectures = lectures.filter(
        (lecture) => lecture.syllabusModule.toString() === module._id.toString()
      );

      return {
        _id: module._id,
        moduleNumber: module.moduleNumber,
        moduleTitle: module.moduleTitle,
        description: module.description,
        topics: module.topics,
        isActive: module.isActive,
        lectures: moduleLectures,
        lectureCount: moduleLectures.length,
      };
    });

    res.json({
      success: true,
      courseId,
      modules: modulesWithLectures,
    });
  } catch (error) {
    logger.error("Error in getCourseModulesWithLectures:", error);
    res.status(500).json({ error: error.message });
  }
};

// Update a lecture
const updateLecture = async function (req, res) {
  let newVideoKey = null;
  let oldVideoKey = null;

  try {
    const { courseId, moduleId, lectureId } = req.params;
    logger.info(`Updating lecture ID: ${lectureId}`);

    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      return res.status(404).json({ error: "Teacher not found" });
    }

    // Find lecture and verify access
    const lecture = await Lecture.findById(lectureId);
    if (!lecture) {
      return res.status(404).json({ error: "Lecture not found" });
    }

    if (lecture.course.toString() !== courseId) {
      return res
        .status(403)
        .json({ error: "Lecture does not belong to specified course" });
    }

    if (lecture.syllabusModule.toString() !== moduleId) {
      return res
        .status(403)
        .json({ error: "Lecture does not belong to specified module" });
    }

    // Verify teacher has access to this course
    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    });

    if (!course) {
      return res
        .status(403)
        .json({ error: "You don't have permission to update this lecture" });
    }

    // Handle video file update if provided
    if (req.files && req.files.video) {
      const videoFile = req.files.video;
      logger.info(
        `Updating video file: ${videoFile.name}, size: ${videoFile.size} bytes`
      );

      // Validate new video file
      try {
        validateVideoFile(videoFile);
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }

      // Upload new video to Azure first
      const azurePath = generateAzurePath(courseId, moduleId, videoFile.name);

      try {
        const uploadResult = await uploadFileToAzure(videoFile, azurePath);
        newVideoKey = uploadResult.key;
        oldVideoKey = lecture.videoKey; // Store old key for cleanup

        // Update lecture with new video info
        lecture.videoUrl = uploadResult.url;
        lecture.videoKey = uploadResult.key;
        lecture.originalVideoName = videoFile.name;

        logger.info(`New video uploaded: ${uploadResult.key}`);
      } catch (uploadError) {
        logger.error("Error uploading new video:", uploadError);
        return res.status(500).json({
          error: "Failed to upload new video",
          details: uploadError.message,
        });
      }
    }

    // Update other lecture fields
    if (req.body.title && req.body.title.trim() !== "") {
      lecture.title = req.body.title.trim();
    }
    if (req.body.content !== undefined) {
      lecture.content = req.body.content;
    }
    if (req.body.lectureOrder) {
      lecture.lectureOrder = req.body.lectureOrder;
    }

    // Handle review status
    if (req.body.isReviewed !== undefined) {
      lecture.isReviewed = req.body.isReviewed;
    }

    if (req.body.reviewDeadline) {
      lecture.reviewDeadline = new Date(req.body.reviewDeadline);
    }

    // Auto-check if the deadline has passed
    const now = new Date();
    if (
      !lecture.isReviewed &&
      lecture.reviewDeadline &&
      now >= lecture.reviewDeadline
    ) {
      lecture.isReviewed = true;
    }

    // Save with retry logic
    await withRetry(async () => {
      const session = await mongoose.startSession();
      let transactionStarted = false;

      try {
        await session.startTransaction();
        transactionStarted = true;

        await lecture.save({ session });

        await session.commitTransaction();
        transactionStarted = false;
      } catch (dbError) {
        if (transactionStarted) {
          await session.abortTransaction();
        }
        throw dbError;
      } finally {
        await session.endSession();
      }
    });

    // Delete old video from Azure if new video was uploaded
    if (oldVideoKey && newVideoKey) {
      try {
        await deleteFileFromAzure(oldVideoKey);
        logger.info(`Deleted old video: ${oldVideoKey}`);
      } catch (deleteError) {
        logger.error("Error deleting old video file:", deleteError);
        // Don't fail the operation if cleanup fails
      }
    }

    logger.info(`Updated lecture ID: ${lecture._id}`);
    res.json({
      success: true,
      message: "Lecture updated successfully",
      lecture,
    });
  } catch (error) {
    logger.error("Error in updateLecture:", error);

    // Clean up new video if database operation failed
    if (newVideoKey) {
      try {
        await deleteFileFromAzure(newVideoKey);
        logger.info(`Cleaned up new video after error: ${newVideoKey}`);
      } catch (cleanupError) {
        logger.error("Error cleaning up new video:", cleanupError);
      }
    }

    res.status(500).json({ error: error.message });
  }
};

// Delete a lecture
const deleteLecture = async function (req, res) {
  try {
    const { courseId, moduleId, lectureId } = req.params;
    logger.info(`Deleting lecture ID: ${lectureId}`);

    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      return res.status(404).json({ error: "Teacher not found" });
    }

    // Verify course ownership
    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    });

    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    // Find the lecture
    const lecture = await Lecture.findOne({
      _id: lectureId,
      course: courseId,
      syllabusModule: moduleId,
    });

    if (!lecture) {
      return res.status(404).json({ error: "Lecture not found" });
    }

    const videoKey = lecture.videoKey;

    // Delete from database with retry logic
    await withRetry(async () => {
      const session = await mongoose.startSession();
      let transactionStarted = false;

      try {
        await session.startTransaction();
        transactionStarted = true;

        // Remove lecture from syllabus module
        const syllabus = await CourseSyllabus.findOne({
          course: courseId,
        }).session(session);
        if (syllabus) {
          const module = syllabus.modules.id(moduleId);
          if (module && module.lectures) {
            module.lectures = module.lectures.filter(
              (id) => id.toString() !== lecture._id.toString()
            );
            await syllabus.save({ session });
          }
        }

        // Delete the lecture
        await Lecture.findByIdAndDelete(lecture._id).session(session);

        await session.commitTransaction();
        transactionStarted = false;
      } catch (dbError) {
        if (transactionStarted) {
          await session.abortTransaction();
        }
        throw dbError;
      } finally {
        await session.endSession();
      }
    });

    // Delete video from Azure after successful database deletion
    if (videoKey) {
      try {
        await deleteFileFromAzure(videoKey);
        logger.info(`Deleted video from Azure: ${videoKey}`);
      } catch (deleteError) {
        logger.error("Error deleting video file:", deleteError);
        // Don't fail the operation if Azure cleanup fails
      }
    }

    logger.info(`Deleted lecture ID: ${lecture._id}`);
    res.json({
      success: true,
      message: "Lecture deleted successfully",
    });
  } catch (error) {
    logger.error("Error in deleteLecture:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get a specific lecture
const getLectureById = async function (req, res) {
  try {
    const { courseId, moduleId, lectureId } = req.params;
    logger.info(`Fetching lecture ID: ${lectureId}`);

    // Find the lecture
    const lecture = await Lecture.findById(lectureId);

    if (!lecture) {
      return res.status(404).json({ error: "Lecture not found" });
    }

    // Verify lecture belongs to the specified course and module
    if (lecture.course.toString() !== courseId) {
      return res
        .status(403)
        .json({ error: "Lecture does not belong to specified course" });
    }

    if (lecture.syllabusModule.toString() !== moduleId) {
      return res
        .status(403)
        .json({ error: "Lecture does not belong to specified module" });
    }

    // Verify user access
    if (req.user.role === "teacher") {
      const teacher = await Teacher.findOne({ user: req.user.id });
      if (!teacher) {
        return res.status(404).json({ error: "Teacher not found" });
      }

      const course = await Course.findOne({
        _id: courseId,
        teacher: teacher._id,
      });

      if (!course) {
        return res
          .status(403)
          .json({ error: "You don't have permission to view this lecture" });
      }
    } else if (req.user.role === "student") {
      const student = await Student.findOne({ user: req.user.id });
      if (!student) {
        return res.status(404).json({ error: "Student not found" });
      }

      if (!student.courses.includes(courseId)) {
        return res
          .status(403)
          .json({ error: "You don't have permission to view this lecture" });
      }
    }

    // Check if review deadline has passed
    const now = new Date();
    if (
      !lecture.isReviewed &&
      lecture.reviewDeadline &&
      now >= lecture.reviewDeadline
    ) {
      lecture.isReviewed = true;
      await lecture.save();
    }

    res.json({
      success: true,
      lecture,
    });
  } catch (error) {
    logger.error("Error in getLectureById:", error);
    res.status(500).json({ error: error.message });
  }
};

// Update lecture order within a module
const updateLectureOrder = async function (req, res) {
  try {
    const { courseId, moduleId } = req.params;
    const { lectureOrders } = req.body; // Array of {lectureId, order}

    if (!lectureOrders || !Array.isArray(lectureOrders)) {
      return res.status(400).json({ error: "Invalid lecture orders data" });
    }

    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      return res.status(404).json({ error: "Teacher not found" });
    }

    // Verify course ownership
    const course = await Course.findOne({
      _id: courseId,
      teacher: teacher._id,
    });

    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    // Update lecture orders with retry logic
    await withRetry(async () => {
      const session = await mongoose.startSession();
      let transactionStarted = false;

      try {
        await session.startTransaction();
        transactionStarted = true;

        const updatePromises = lectureOrders.map(({ lectureId, order }) =>
          Lecture.findOneAndUpdate(
            {
              _id: lectureId,
              course: courseId,
              syllabusModule: moduleId,
            },
            { lectureOrder: order },
            { session, new: true }
          )
        );

        await Promise.all(updatePromises);

        await session.commitTransaction();
        transactionStarted = false;
      } catch (dbError) {
        if (transactionStarted) {
          await session.abortTransaction();
        }
        throw dbError;
      } finally {
        await session.endSession();
      }
    });

    res.json({
      success: true,
      message: "Lecture order updated successfully",
    });
  } catch (error) {
    logger.error("Error in updateLectureOrder:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createLectureForModule,
  getModuleLectures,
  getCourseModulesWithLectures,
  updateLecture,
  deleteLecture,
  getLectureById,
  updateLectureOrder,
};
