const mongoose = require("mongoose");
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

// Function to handle file uploads (for content files)
const handleFileUploads = async (files, allowedTypes, path, next) => {
  console.log("Processing file uploads");

  let filesArray = Array.isArray(files) ? files : [files];
  console.log(`Found ${filesArray.length} files`);

  // Validate file types and sizes
  for (const file of filesArray) {
    console.log(
      `Validating file: ${file.name}, type: ${file.mimetype}, size: ${file.size}`
    );

    if (!allowedTypes.includes(file.mimetype)) {
      console.log(`Invalid file type: ${file.mimetype}`);
      throw new ErrorHandler(
        `Invalid file type for ${file.name}. Allowed types: ${allowedTypes.join(
          ", "
        )}`,
        400
      );
    }

    // Validate file size (50MB for videos, 10MB for others)
    const maxSize =
      allowedTypes.includes("video/mp4") ||
      allowedTypes.includes("video/webm") ||
      allowedTypes.includes("video/avi") ||
      allowedTypes.includes("video/mov") ||
      allowedTypes.includes("video/wmv") ||
      allowedTypes.includes("video/ogg")
        ? 50 * 1024 * 1024 // 50MB for videos
        : 10 * 1024 * 1024; // 10MB for others

    if (file.size > maxSize) {
      console.log(`File too large: ${file.size} bytes`);
      throw new ErrorHandler(
        `File ${file.name} is too large. Maximum size allowed is ${
          maxSize / (1024 * 1024)
        }MB`,
        400
      );
    }
  }

  // Upload files to Azure
  console.log("Starting file uploads to Azure");
  const uploadPromises = filesArray.map(async (file) => {
    try {
      return await uploadFileToAzure(file, path);
    } catch (uploadError) {
      console.error(`Failed to upload ${file.name}:`, uploadError);
      throw new ErrorHandler(
        `Failed to upload ${file.name}: ${uploadError.message}`,
        500
      );
    }
  });

  const uploadedFiles = await Promise.all(uploadPromises);
  console.log(`Successfully uploaded ${uploadedFiles.length} files`);

  return { filesArray, uploadedFiles };
};

// Function to handle thumbnail uploads
const handleThumbnailUpload = async (thumbnailFile, path) => {
  if (!thumbnailFile) return null;

  console.log("Processing thumbnail upload");

  // Validate thumbnail file type
  const allowedThumbnailTypes = [
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/gif",
    "image/webp",
  ];

  if (!allowedThumbnailTypes.includes(thumbnailFile.mimetype)) {
    throw new ErrorHandler(
      "Invalid thumbnail file type. Allowed types: JPG, PNG, GIF, WEBP",
      400
    );
  }

  // Validate thumbnail file size (5MB)
  if (thumbnailFile.size > 5 * 1024 * 1024) {
    throw new ErrorHandler(
      "Thumbnail file too large. Maximum size allowed is 5MB",
      400
    );
  }

  try {
    const thumbnailPath = `${path}/thumbnails`;
    const uploadResult = await uploadFileToAzure(thumbnailFile, thumbnailPath);

    return {
      thumbnailUrl: uploadResult.url,
      thumbnailKey: uploadResult.key,
    };
  } catch (uploadError) {
    console.error("Error uploading thumbnail:", uploadError);
    throw new ErrorHandler(
      `Failed to upload thumbnail: ${uploadError.message}`,
      500
    );
  }
};

// Helper function to verify teacher access to course
const verifyTeacherAccess = async (userId, courseId, session = null) => {
  const teacher = await Teacher.findOne({ user: userId }).session(session);
  if (!teacher) {
    throw new ErrorHandler("Teacher not found", 404);
  }

  const course = await Course.findOne({
    _id: courseId,
    teacher: teacher._id,
  }).session(session);

  if (!course) {
    throw new ErrorHandler("Course not found or unauthorized", 404);
  }

  return { teacher, course };
};

// Helper function to verify student access to course
const verifyStudentAccess = async (userId, courseId) => {
  const student = await Student.findOne({ user: userId });
  if (!student) {
    throw new ErrorHandler("Student not found", 404);
  }

  const isEnrolled = student.courses.some((id) => id.toString() === courseId);
  if (!isEnrolled) {
    throw new ErrorHandler("You are not enrolled in this course", 403);
  }

  return student;
};

// Get course syllabus with modules
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
    await verifyTeacherAccess(req.user.id, courseId);
  } else if (req.user.role === "student") {
    await verifyStudentAccess(req.user.id, courseId);
  } else {
    return next(new ErrorHandler("Invalid user role", 403));
  }

  // Find CourseSyllabus with populated lectures
  const syllabus = await CourseSyllabus.findOne({ course: courseId }).populate({
    path: "modules.lectures",
    model: "Lecture",
    select:
      "title content videoUrl videoKey moduleNumber lectureOrder isReviewed reviewDeadline createdAt updatedAt",
    options: { sort: { lectureOrder: 1 } }, // Sort lectures by order
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

  // Format the response with simplified module data
  const formattedSyllabus = {
    _id: syllabus._id,
    course: syllabus.course,
    modules: syllabus.modules.map((module) => ({
      _id: module._id,
      moduleNumber: module.moduleNumber,
      moduleTitle: module.moduleTitle,
      description: module.description,
      isActive: module.isActive,
      order: module.order,

      // Sort content by order
      videos: module.videos
        ? [...module.videos].sort((a, b) => (a.order || 0) - (b.order || 0))
        : [],
      links: module.links
        ? [...module.links].sort((a, b) => (a.order || 0) - (b.order || 0))
        : [],
      pdfs: module.pdfs
        ? [...module.pdfs].sort((a, b) => (a.order || 0) - (b.order || 0))
        : [],
      ppts: module.ppts
        ? [...module.ppts].sort((a, b) => (a.order || 0) - (b.order || 0))
        : [],

      // Lectures are already sorted from populate
      lectures: module.lectures || [],

      // Content counts
      videoCount: module.videos ? module.videos.length : 0,
      linkCount: module.links ? module.links.length : 0,
      pdfCount: module.pdfs ? module.pdfs.length : 0,
      pptCount: module.ppts ? module.ppts.length : 0,
      lectureCount: module.lectures ? module.lectures.length : 0,

      hasContent:
        module.videos?.length > 0 ||
        module.links?.length > 0 ||
        module.pdfs?.length > 0 ||
        module.ppts?.length > 0 ||
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

// Create a new module
exports.createModule = catchAsyncErrors(async (req, res, next) => {
  console.log("createModule: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { moduleNumber, moduleTitle, description } = req.body;
    const { courseId } = req.params;

    console.log(`Creating module for course: ${courseId}`);

    // Validate inputs
    if (!moduleNumber || !moduleTitle) {
      console.log("Missing required fields");
      return next(
        new ErrorHandler("ModuleNumber and moduleTitle are required", 400)
      );
    }

    // Validate moduleNumber is a positive integer
    if (!Number.isInteger(moduleNumber) || moduleNumber <= 0) {
      return next(
        new ErrorHandler("Module number must be a positive integer", 400)
      );
    }

    // Check if teacher is authorized
    await verifyTeacherAccess(req.user.id, courseId, session);

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

    // Create new module
    const newModule = {
      moduleNumber,
      moduleTitle: moduleTitle.trim(),
      description: description ? description.trim() : "",
      videos: [],
      links: [],
      pdfs: [],
      ppts: [],
      lectures: [],
      isActive: true,
      order: syllabus.modules.length + 1,
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

// Get specific module by ID
exports.getModuleById = catchAsyncErrors(async (req, res, next) => {
  console.log("getModuleById: Started");
  const { courseId, moduleId } = req.params;

  console.log(`Fetching module ${moduleId} for course: ${courseId}`);

  // Verify user access
  if (req.user.role === "teacher") {
    await verifyTeacherAccess(req.user.id, courseId);
  } else if (req.user.role === "student") {
    await verifyStudentAccess(req.user.id, courseId);
  } else {
    return next(new ErrorHandler("Invalid user role", 403));
  }

  // Find CourseSyllabus with populated lectures
  const syllabus = await CourseSyllabus.findOne({ course: courseId }).populate({
    path: "modules.lectures",
    model: "Lecture",
    select:
      "title content videoUrl videoKey moduleNumber lectureOrder isReviewed reviewDeadline createdAt updatedAt",
    options: { sort: { lectureOrder: 1 } },
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
    moduleNumber: module.moduleNumber,
    moduleTitle: module.moduleTitle,
    description: module.description,
    isActive: module.isActive,
    order: module.order,

    // Sort content by order
    videos: module.videos
      ? [...module.videos].sort((a, b) => (a.order || 0) - (b.order || 0))
      : [],
    links: module.links
      ? [...module.links].sort((a, b) => (a.order || 0) - (b.order || 0))
      : [],
    pdfs: module.pdfs
      ? [...module.pdfs].sort((a, b) => (a.order || 0) - (b.order || 0))
      : [],
    ppts: module.ppts
      ? [...module.ppts].sort((a, b) => (a.order || 0) - (b.order || 0))
      : [],

    // Lectures are already sorted from populate
    lectures: module.lectures || [],

    // Content counts
    videoCount: module.videos ? module.videos.length : 0,
    linkCount: module.links ? module.links.length : 0,
    pdfCount: module.pdfs ? module.pdfs.length : 0,
    pptCount: module.ppts ? module.ppts.length : 0,
    lectureCount: module.lectures ? module.lectures.length : 0,

    hasContent:
      module.videos?.length > 0 ||
      module.links?.length > 0 ||
      module.pdfs?.length > 0 ||
      module.ppts?.length > 0 ||
      module.lectures?.length > 0,
  };

  res.status(200).json({
    success: true,
    courseId: courseId,
    moduleId: moduleId,
    module: formattedModule,
  });
});

// Update module basic info
exports.updateModule = catchAsyncErrors(async (req, res, next) => {
  console.log("updateModule: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const { moduleNumber, moduleTitle, description, isActive } = req.body;
    const { courseId, moduleId } = req.params;

    console.log(`Updating module ${moduleId} for course: ${courseId}`);

    // Check authorization
    await verifyTeacherAccess(req.user.id, courseId, session);

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
      // Validate moduleNumber is a positive integer
      if (!Number.isInteger(moduleNumber) || moduleNumber <= 0) {
        return next(
          new ErrorHandler("Module number must be a positive integer", 400)
        );
      }

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
    if (moduleNumber) module.moduleNumber = moduleNumber;
    if (moduleTitle) module.moduleTitle = moduleTitle.trim();
    if (description !== undefined) module.description = description.trim();
    if (isActive !== undefined) module.isActive = isActive;

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
        moduleNumber: module.moduleNumber,
        moduleTitle: module.moduleTitle,
        description: module.description,
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
    await verifyTeacherAccess(req.user.id, courseId, session);

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

    // Collect all files to delete from Azure
    const filesToDelete = [];

    // Collect video files
    if (module.videos) {
      module.videos.forEach((video) => {
        if (video.fileKey) filesToDelete.push(video.fileKey);
        if (video.thumbnail?.thumbnailKey)
          filesToDelete.push(video.thumbnail.thumbnailKey);
      });
    }

    // Collect PDF files
    if (module.pdfs) {
      module.pdfs.forEach((pdf) => {
        if (pdf.fileKey) filesToDelete.push(pdf.fileKey);
        if (pdf.thumbnail?.thumbnailKey)
          filesToDelete.push(pdf.thumbnail.thumbnailKey);
      });
    }

    // Collect PPT files
    if (module.ppts) {
      module.ppts.forEach((ppt) => {
        if (ppt.fileKey) filesToDelete.push(ppt.fileKey);
        if (ppt.thumbnail?.thumbnailKey)
          filesToDelete.push(ppt.thumbnail.thumbnailKey);
      });
    }

    // Collect link thumbnails
    if (module.links) {
      module.links.forEach((link) => {
        if (link.thumbnail?.thumbnailKey)
          filesToDelete.push(link.thumbnail.thumbnailKey);
      });
    }

    // Delete files from Azure (do this before database transaction commit)
    if (filesToDelete.length > 0) {
      console.log(`Deleting ${filesToDelete.length} files from Azure`);
      const deletePromises = filesToDelete.map(async (fileKey) => {
        try {
          await deleteFileFromAzure(fileKey);
          console.log(`Deleted file: ${fileKey}`);
        } catch (azureError) {
          console.error(
            `Error deleting file ${fileKey} from Azure:`,
            azureError
          );
          // Continue with other deletions
        }
      });

      await Promise.allSettled(deletePromises); // Use allSettled to continue even if some deletions fail
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
      deletedFiles: filesToDelete.length,
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

// Add content to module (PDF, PPT, Video, or Link)
exports.addModuleContent = catchAsyncErrors(async (req, res, next) => {
  console.log("addModuleContent: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;
  let uploadedFiles = []; // Track uploaded files for cleanup

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { courseId, moduleId } = req.params;
    const { contentType, name, description, fileUrl } = req.body;

    console.log(
      `Adding ${contentType} content to module ${moduleId} for course: ${courseId}`
    );

    // Validate content type
    if (!["pdf", "ppt", "video", "link"].includes(contentType)) {
      return next(
        new ErrorHandler(
          "Invalid content type. Must be pdf, ppt, video, or link",
          400
        )
      );
    }

    // Check if teacher is authorized
    await verifyTeacherAccess(req.user.id, courseId, session);

    // Find syllabus and module
    const syllabus = await CourseSyllabus.findOne({ course: courseId }).session(
      session
    );
    if (!syllabus) {
      console.log(`No syllabus found for course: ${courseId}`);
      return next(new ErrorHandler("No syllabus found for this course", 404));
    }

    const module = syllabus.modules.id(moduleId);
    if (!module) {
      console.log(`Module not found: ${moduleId}`);
      return next(new ErrorHandler("Module not found", 404));
    }

    // Initialize content arrays if they don't exist
    if (!module.videos) module.videos = [];
    if (!module.links) module.links = [];
    if (!module.pdfs) module.pdfs = [];
    if (!module.ppts) module.ppts = [];

    // Create base content item
    const contentItem = {
      name: name ? name.trim() : "Untitled Content",
      description: description ? description.trim() : "",
      createDate: new Date(),
      isActive: true,
      thumbnail: {
        thumbnailUrl: "",
        thumbnailKey: "",
      },
    };

    // Handle thumbnail upload if provided
    if (req.files && req.files.thumbnail) {
      try {
        const thumbnailPath = `syllabus-thumbnails/course-${courseId}/module-${moduleId}`;
        const thumbnailResult = await handleThumbnailUpload(
          req.files.thumbnail,
          thumbnailPath
        );
        if (thumbnailResult) {
          contentItem.thumbnail = thumbnailResult;
          uploadedFiles.push(thumbnailResult.thumbnailKey);
        }
      } catch (thumbnailError) {
        console.error("Error handling thumbnail upload:", thumbnailError);
        return next(thumbnailError);
      }
    }

    // Process content based on type
    switch (contentType) {
      case "pdf":
        // Handle PDF upload
        if (!req.files || !req.files.file) {
          return next(new ErrorHandler("No PDF file uploaded", 400));
        }

        try {
          const allowedTypes = ["application/pdf"];
          const { filesArray, uploadedFiles: pdfFiles } =
            await handleFileUploads(
              req.files.file,
              allowedTypes,
              "syllabus-pdfs",
              next
            );

          const file = filesArray[0];
          const uploadedFile = pdfFiles[0];
          uploadedFiles.push(uploadedFile.key);

          contentItem.fileUrl = uploadedFile.url;
          contentItem.fileKey = uploadedFile.key;
          contentItem.fileName = file.name;
          contentItem.fileSize = file.size;
          contentItem.order = module.pdfs.length + 1;

          module.pdfs.push(contentItem);
        } catch (uploadError) {
          console.error("Error handling PDF upload:", uploadError);
          return next(uploadError);
        }
        break;

      case "ppt":
        // Handle PPT upload
        if (!req.files || !req.files.file) {
          return next(new ErrorHandler("No PPT file uploaded", 400));
        }

        try {
          const allowedTypes = [
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          ];
          const { filesArray, uploadedFiles: pptFiles } =
            await handleFileUploads(
              req.files.file,
              allowedTypes,
              "syllabus-ppts",
              next
            );

          const file = filesArray[0];
          const uploadedFile = pptFiles[0];
          uploadedFiles.push(uploadedFile.key);

          // Determine presentation type
          let presentationType = "pptx";
          if (file.mimetype === "application/vnd.ms-powerpoint") {
            presentationType = "ppt";
          }

          contentItem.fileUrl = uploadedFile.url;
          contentItem.fileKey = uploadedFile.key;
          contentItem.fileName = file.name;
          contentItem.fileSize = file.size;
          contentItem.presentationType = presentationType;
          contentItem.order = module.ppts.length + 1;

          module.ppts.push(contentItem);
        } catch (uploadError) {
          console.error("Error handling PPT upload:", uploadError);
          return next(uploadError);
        }
        break;

      case "video":
        // Handle video upload
        if (!req.files || !req.files.file) {
          return next(new ErrorHandler("No video file uploaded", 400));
        }

        try {
          const allowedTypes = [
            "video/mp4",
            "video/webm",
            "video/ogg",
            "video/avi",
            "video/mov",
            "video/wmv",
          ];
          const { filesArray, uploadedFiles: videoFiles } =
            await handleFileUploads(
              req.files.file,
              allowedTypes,
              "syllabus-videos",
              next
            );

          const file = filesArray[0];
          const uploadedFile = videoFiles[0];
          uploadedFiles.push(uploadedFile.key);

          contentItem.fileUrl = uploadedFile.url;
          contentItem.fileKey = uploadedFile.key;
          contentItem.fileName = file.name;
          contentItem.videoSize = file.size;
          contentItem.duration = req.body.duration || "";
          contentItem.videoQuality = req.body.videoQuality || "auto";
          contentItem.order = module.videos.length + 1;

          module.videos.push(contentItem);
        } catch (uploadError) {
          console.error("Error handling video upload:", uploadError);
          return next(uploadError);
        }
        break;

      case "link":
        // Handle link
        if (!fileUrl) {
          return next(
            new ErrorHandler("URL is required for link content type", 400)
          );
        }

        // Validate URL format
        if (!/^https?:\/\/.+/.test(fileUrl)) {
          return next(new ErrorHandler("Invalid URL format", 400));
        }

        contentItem.fileUrl = fileUrl;
        contentItem.linkType = req.body.linkType || "external";
        contentItem.isExternal = true;
        contentItem.order = module.links.length + 1;

        module.links.push(contentItem);
        break;
    }

    console.log("Saving updated syllabus");
    await syllabus.save({ session });
    console.log("Syllabus updated with new content item");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(201).json({
      success: true,
      message: `${contentType.toUpperCase()} content added to module successfully`,
      contentType,
      contentItem,
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

    // Clean up uploaded files if transaction failed
    if (uploadedFiles.length > 0) {
      console.log(`Cleaning up ${uploadedFiles.length} uploaded files`);
      const cleanupPromises = uploadedFiles.map(async (fileKey) => {
        try {
          await deleteFileFromAzure(fileKey);
          console.log(`Cleaned up file: ${fileKey}`);
        } catch (cleanupError) {
          console.error(`Error cleaning up file ${fileKey}:`, cleanupError);
        }
      });
      await Promise.allSettled(cleanupPromises);
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    console.log("Ending session");
    await session.endSession();
    console.log("Session ended");
  }
});

// Update content item
exports.updateContentItem = catchAsyncErrors(async (req, res, next) => {
  console.log("updateContentItem: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;
  let uploadedFiles = []; // Track new uploaded files for cleanup

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { courseId, moduleId, contentType, contentId } = req.params;
    const { name, description, fileUrl } = req.body;

    console.log(
      `Updating ${contentType} content ${contentId} in module ${moduleId} for course: ${courseId}`
    );

    // Validate content type
    if (!["pdf", "ppt", "video", "link"].includes(contentType)) {
      return next(
        new ErrorHandler(
          "Invalid content type. Must be pdf, ppt, video, or link",
          400
        )
      );
    }

    // Check authorization
    await verifyTeacherAccess(req.user.id, courseId, session);

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

    // Find content item based on type
    let contentArray = [];
    let contentIndex = -1;

    switch (contentType) {
      case "pdf":
        contentArray = module.pdfs || [];
        contentIndex = contentArray.findIndex(
          (item) => item._id.toString() === contentId
        );
        break;
      case "ppt":
        contentArray = module.ppts || [];
        contentIndex = contentArray.findIndex(
          (item) => item._id.toString() === contentId
        );
        break;
      case "video":
        contentArray = module.videos || [];
        contentIndex = contentArray.findIndex(
          (item) => item._id.toString() === contentId
        );
        break;
      case "link":
        contentArray = module.links || [];
        contentIndex = contentArray.findIndex(
          (item) => item._id.toString() === contentId
        );
        break;
    }

    if (contentIndex === -1) {
      return next(new ErrorHandler("Content item not found", 404));
    }

    const contentItem = contentArray[contentIndex];
    const oldFileKey = contentItem.fileKey;
    const oldThumbnailKey = contentItem.thumbnail?.thumbnailKey;

    // Update basic fields
    if (name) contentItem.name = name.trim();
    if (description !== undefined) contentItem.description = description.trim();

    // Handle thumbnail update if provided
    if (req.files && req.files.thumbnail) {
      try {
        const thumbnailPath = `syllabus-thumbnails/course-${courseId}/module-${moduleId}`;
        const thumbnailResult = await handleThumbnailUpload(
          req.files.thumbnail,
          thumbnailPath
        );
        if (thumbnailResult) {
          uploadedFiles.push(thumbnailResult.thumbnailKey);
          contentItem.thumbnail = thumbnailResult;
        }
      } catch (thumbnailError) {
        console.error("Error handling thumbnail upload:", thumbnailError);
        return next(thumbnailError);
      }
    }

    // Handle file replacement for file-based content types
    if (
      ["pdf", "ppt", "video"].includes(contentType) &&
      req.files &&
      req.files.file
    ) {
      try {
        let allowedTypes = [];
        let uploadPath = "";

        switch (contentType) {
          case "pdf":
            allowedTypes = ["application/pdf"];
            uploadPath = "syllabus-pdfs";
            break;
          case "ppt":
            allowedTypes = [
              "application/vnd.ms-powerpoint",
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ];
            uploadPath = "syllabus-ppts";
            break;
          case "video":
            allowedTypes = [
              "video/mp4",
              "video/webm",
              "video/ogg",
              "video/avi",
              "video/mov",
              "video/wmv",
            ];
            uploadPath = "syllabus-videos";
            break;
        }

        const { filesArray, uploadedFiles: newFiles } = await handleFileUploads(
          req.files.file,
          allowedTypes,
          uploadPath,
          next
        );

        const file = filesArray[0];
        const uploadedFile = newFiles[0];
        uploadedFiles.push(uploadedFile.key);

        // Update file properties
        contentItem.fileUrl = uploadedFile.url;
        contentItem.fileKey = uploadedFile.key;
        contentItem.fileName = file.name;

        if (contentType === "pdf" || contentType === "ppt") {
          contentItem.fileSize = file.size;
        } else if (contentType === "video") {
          contentItem.videoSize = file.size;
        }

        if (contentType === "ppt") {
          contentItem.presentationType =
            file.mimetype === "application/vnd.ms-powerpoint" ? "ppt" : "pptx";
        }
      } catch (uploadError) {
        console.error("Error handling file upload:", uploadError);
        return next(uploadError);
      }
    }

    // Handle link URL update
    if (contentType === "link" && fileUrl) {
      if (!/^https?:\/\/.+/.test(fileUrl)) {
        return next(new ErrorHandler("Invalid URL format", 400));
      }
      contentItem.fileUrl = fileUrl;
    }

    // Update specific fields based on content type
    if (contentType === "video") {
      if (req.body.duration) contentItem.duration = req.body.duration;
      if (req.body.videoQuality)
        contentItem.videoQuality = req.body.videoQuality;
    }

    if (contentType === "link") {
      if (req.body.linkType) contentItem.linkType = req.body.linkType;
    }

    console.log("Saving updated syllabus");
    await syllabus.save({ session });
    console.log("Content item updated successfully");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    // Clean up old files after successful transaction
    const filesToCleanup = [];
    if (oldFileKey && uploadedFiles.some((key) => key !== oldFileKey)) {
      filesToCleanup.push(oldFileKey);
    }
    if (oldThumbnailKey && req.files && req.files.thumbnail) {
      filesToCleanup.push(oldThumbnailKey);
    }

    if (filesToCleanup.length > 0) {
      console.log(`Cleaning up ${filesToCleanup.length} old files`);
      const cleanupPromises = filesToCleanup.map(async (fileKey) => {
        try {
          await deleteFileFromAzure(fileKey);
          console.log(`Cleaned up old file: ${fileKey}`);
        } catch (deleteError) {
          console.error(`Error deleting old file ${fileKey}:`, deleteError);
        }
      });
      await Promise.allSettled(cleanupPromises);
    }

    res.status(200).json({
      success: true,
      message: `${contentType.toUpperCase()} content updated successfully`,
      contentType,
      contentItem,
    });
  } catch (error) {
    console.log(`Error in updateContentItem: ${error.message}`);

    if (transactionStarted) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }

    // Clean up newly uploaded files if transaction failed
    if (uploadedFiles.length > 0) {
      console.log(
        `Cleaning up ${uploadedFiles.length} uploaded files due to error`
      );
      const cleanupPromises = uploadedFiles.map(async (fileKey) => {
        try {
          await deleteFileFromAzure(fileKey);
          console.log(`Cleaned up file: ${fileKey}`);
        } catch (cleanupError) {
          console.error(`Error cleaning up file ${fileKey}:`, cleanupError);
        }
      });
      await Promise.allSettled(cleanupPromises);
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    await session.endSession();
  }
});

// Delete content item
exports.deleteContentItem = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteContentItem: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { courseId, moduleId, contentType, contentId } = req.params;

    console.log(
      `Deleting ${contentType} content ${contentId} from module ${moduleId} for course: ${courseId}`
    );

    // Validate content type
    if (!["pdf", "ppt", "video", "link"].includes(contentType)) {
      return next(
        new ErrorHandler(
          "Invalid content type. Must be pdf, ppt, video, or link",
          400
        )
      );
    }

    // Check authorization
    await verifyTeacherAccess(req.user.id, courseId, session);

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

    // Find and remove content item based on type
    let contentArray = [];
    let contentIndex = -1;
    let contentItem = null;

    switch (contentType) {
      case "pdf":
        contentArray = module.pdfs || [];
        contentIndex = contentArray.findIndex(
          (item) => item._id.toString() === contentId
        );
        if (contentIndex !== -1) {
          contentItem = contentArray[contentIndex];
          module.pdfs.splice(contentIndex, 1);
        }
        break;
      case "ppt":
        contentArray = module.ppts || [];
        contentIndex = contentArray.findIndex(
          (item) => item._id.toString() === contentId
        );
        if (contentIndex !== -1) {
          contentItem = contentArray[contentIndex];
          module.ppts.splice(contentIndex, 1);
        }
        break;
      case "video":
        contentArray = module.videos || [];
        contentIndex = contentArray.findIndex(
          (item) => item._id.toString() === contentId
        );
        if (contentIndex !== -1) {
          contentItem = contentArray[contentIndex];
          module.videos.splice(contentIndex, 1);
        }
        break;
      case "link":
        contentArray = module.links || [];
        contentIndex = contentArray.findIndex(
          (item) => item._id.toString() === contentId
        );
        if (contentIndex !== -1) {
          contentItem = contentArray[contentIndex];
          module.links.splice(contentIndex, 1);
        }
        break;
    }

    if (contentIndex === -1) {
      return next(new ErrorHandler("Content item not found", 404));
    }

    // Collect files to delete from Azure
    const filesToDelete = [];

    // Delete main file from Azure if it's a file-based content type
    if (["pdf", "ppt", "video"].includes(contentType) && contentItem.fileKey) {
      filesToDelete.push(contentItem.fileKey);
    }

    // Delete thumbnail if exists (for all content types)
    if (contentItem.thumbnail?.thumbnailKey) {
      filesToDelete.push(contentItem.thumbnail.thumbnailKey);
    }

    console.log("Saving updated syllabus");
    await syllabus.save({ session });
    console.log("Content item removed from module");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    // Delete files from Azure after successful database transaction
    if (filesToDelete.length > 0) {
      console.log(`Deleting ${filesToDelete.length} files from Azure`);
      const deletePromises = filesToDelete.map(async (fileKey) => {
        try {
          await deleteFileFromAzure(fileKey);
          console.log(`Deleted file from Azure: ${fileKey}`);
        } catch (azureError) {
          console.error(
            `Error deleting file ${fileKey} from Azure:`,
            azureError
          );
        }
      });
      await Promise.allSettled(deletePromises);
    }

    res.status(200).json({
      success: true,
      message: `${contentType.toUpperCase()} content deleted successfully`,
      courseId: courseId,
      moduleId: moduleId,
      contentType: contentType,
      contentId: contentId,
      deletedFiles: filesToDelete.length,
    });
  } catch (error) {
    console.log(`Error in deleteContentItem: ${error.message}`);
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

// Update content order within a module
exports.updateContentOrder = catchAsyncErrors(async (req, res, next) => {
  console.log("updateContentOrder: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;

    const { courseId, moduleId, contentType } = req.params;
    const { contentOrders } = req.body; // Array of {contentId, order}

    if (!contentOrders || !Array.isArray(contentOrders)) {
      return next(new ErrorHandler("Invalid content orders data", 400));
    }

    // Validate content type
    if (!["pdf", "ppt", "video", "link"].includes(contentType)) {
      return next(
        new ErrorHandler(
          "Invalid content type. Must be pdf, ppt, video, or link",
          400
        )
      );
    }

    // Check authorization
    await verifyTeacherAccess(req.user.id, courseId, session);

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

    // Update content order based on type
    let contentArray = [];
    switch (contentType) {
      case "pdf":
        contentArray = module.pdfs || [];
        break;
      case "ppt":
        contentArray = module.ppts || [];
        break;
      case "video":
        contentArray = module.videos || [];
        break;
      case "link":
        contentArray = module.links || [];
        break;
    }

    // Update orders
    contentOrders.forEach(({ contentId, order }) => {
      const contentIndex = contentArray.findIndex(
        (item) => item._id.toString() === contentId
      );
      if (contentIndex !== -1 && Number.isInteger(order) && order > 0) {
        contentArray[contentIndex].order = order;
      }
    });

    await syllabus.save({ session });

    await session.commitTransaction();
    transactionStarted = false;

    res.json({
      success: true,
      message: `${contentType.toUpperCase()} content order updated successfully`,
    });
  } catch (error) {
    console.log(`Error in updateContentOrder: ${error.message}`);
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

// Get content item by ID
exports.getContentItemById = catchAsyncErrors(async (req, res, next) => {
  console.log("getContentItemById: Started");
  const { courseId, moduleId, contentType, contentId } = req.params;

  console.log(
    `Fetching ${contentType} content ${contentId} from module ${moduleId} for course: ${courseId}`
  );

  // Validate content type
  if (!["pdf", "ppt", "video", "link"].includes(contentType)) {
    return next(
      new ErrorHandler(
        "Invalid content type. Must be pdf, ppt, video, or link",
        400
      )
    );
  }

  // Verify user access
  if (req.user.role === "teacher") {
    await verifyTeacherAccess(req.user.id, courseId);
  } else if (req.user.role === "student") {
    await verifyStudentAccess(req.user.id, courseId);
  } else {
    return next(new ErrorHandler("Invalid user role", 403));
  }

  // Find syllabus and module
  const syllabus = await CourseSyllabus.findOne({ course: courseId });
  if (!syllabus) {
    return next(new ErrorHandler("Course syllabus not found", 404));
  }

  const module = syllabus.modules.id(moduleId);
  if (!module) {
    return next(new ErrorHandler("Module not found", 404));
  }

  // Find content item based on type
  let contentArray = [];
  let contentItem = null;

  switch (contentType) {
    case "pdf":
      contentArray = module.pdfs || [];
      contentItem = contentArray.find(
        (item) => item._id.toString() === contentId
      );
      break;
    case "ppt":
      contentArray = module.ppts || [];
      contentItem = contentArray.find(
        (item) => item._id.toString() === contentId
      );
      break;
    case "video":
      contentArray = module.videos || [];
      contentItem = contentArray.find(
        (item) => item._id.toString() === contentId
      );
      break;
    case "link":
      contentArray = module.links || [];
      contentItem = contentArray.find(
        (item) => item._id.toString() === contentId
      );
      break;
  }

  if (!contentItem) {
    return next(new ErrorHandler("Content item not found", 404));
  }

  res.status(200).json({
    success: true,
    courseId: courseId,
    moduleId: moduleId,
    contentType: contentType,
    contentId: contentId,
    contentItem: contentItem,
  });
});

// Bulk upload content to module
exports.bulkUploadContent = catchAsyncErrors(async (req, res, next) => {
  console.log("bulkUploadContent: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;
  let uploadedFiles = []; // Track uploaded files for cleanup

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { courseId, moduleId } = req.params;
    const { contentType } = req.body;

    console.log(
      `Bulk uploading ${contentType} content to module ${moduleId} for course: ${courseId}`
    );

    // Validate content type
    if (!["pdf", "ppt", "video"].includes(contentType)) {
      return next(
        new ErrorHandler(
          "Invalid content type for bulk upload. Must be pdf, ppt, or video",
          400
        )
      );
    }

    // Check if teacher is authorized
    await verifyTeacherAccess(req.user.id, courseId, session);

    // Find syllabus and module
    const syllabus = await CourseSyllabus.findOne({ course: courseId }).session(
      session
    );
    if (!syllabus) {
      console.log(`No syllabus found for course: ${courseId}`);
      return next(new ErrorHandler("No syllabus found for this course", 404));
    }

    const module = syllabus.modules.id(moduleId);
    if (!module) {
      console.log(`Module not found: ${moduleId}`);
      return next(new ErrorHandler("Module not found", 404));
    }

    // Check if files are provided
    if (!req.files || !req.files.files) {
      return next(new ErrorHandler("No files uploaded", 400));
    }

    const files = Array.isArray(req.files.files)
      ? req.files.files
      : [req.files.files];
    console.log(`Processing ${files.length} files for bulk upload`);

    // Define allowed types based on content type
    let allowedTypes = [];
    let uploadPath = "";

    switch (contentType) {
      case "pdf":
        allowedTypes = ["application/pdf"];
        uploadPath = "syllabus-pdfs";
        if (!module.pdfs) module.pdfs = [];
        break;
      case "ppt":
        allowedTypes = [
          "application/vnd.ms-powerpoint",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ];
        uploadPath = "syllabus-ppts";
        if (!module.ppts) module.ppts = [];
        break;
      case "video":
        allowedTypes = [
          "video/mp4",
          "video/webm",
          "video/ogg",
          "video/avi",
          "video/mov",
          "video/wmv",
        ];
        uploadPath = "syllabus-videos";
        if (!module.videos) module.videos = [];
        break;
    }

    const uploadedContentItems = [];
    const skippedFiles = [];

    // Process each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        // Validate file type
        if (!allowedTypes.includes(file.mimetype)) {
          console.log(
            `Skipping file ${file.name} - invalid type: ${file.mimetype}`
          );
          skippedFiles.push({
            name: file.name,
            reason: `Invalid file type: ${file.mimetype}`,
          });
          continue;
        }

        // Validate file size
        const maxSize =
          contentType === "video" ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
        if (file.size > maxSize) {
          console.log(
            `Skipping file ${file.name} - too large: ${file.size} bytes`
          );
          skippedFiles.push({
            name: file.name,
            reason: `File too large: ${(file.size / (1024 * 1024)).toFixed(
              2
            )}MB`,
          });
          continue;
        }

        // Upload file to Azure
        const uploadResult = await uploadFileToAzure(file, uploadPath);
        uploadedFiles.push(uploadResult.key);

        // Create content item
        const contentItem = {
          name: file.name.split(".")[0], // Remove extension for name
          description: `Bulk uploaded ${contentType.toUpperCase()}`,
          createDate: new Date(),
          isActive: true,
          fileUrl: uploadResult.url,
          fileKey: uploadResult.key,
          fileName: file.name,
          fileSize: file.size,
          thumbnail: {
            thumbnailUrl: "",
            thumbnailKey: "",
          },
        };

        // Add content type specific fields
        if (contentType === "ppt") {
          contentItem.presentationType =
            file.mimetype === "application/vnd.ms-powerpoint" ? "ppt" : "pptx";
        } else if (contentType === "video") {
          contentItem.videoSize = file.size;
          contentItem.duration = "";
          contentItem.videoQuality = "auto";
        }

        // Set order based on current content count
        switch (contentType) {
          case "pdf":
            contentItem.order =
              module.pdfs.length + uploadedContentItems.length + 1;
            break;
          case "ppt":
            contentItem.order =
              module.ppts.length + uploadedContentItems.length + 1;
            break;
          case "video":
            contentItem.order =
              module.videos.length + uploadedContentItems.length + 1;
            break;
        }

        uploadedContentItems.push(contentItem);
        console.log(`Successfully processed file: ${file.name}`);
      } catch (fileError) {
        console.error(`Error processing file ${file.name}:`, fileError);
        skippedFiles.push({
          name: file.name,
          reason: `Processing error: ${fileError.message}`,
        });
      }
    }

    if (uploadedContentItems.length === 0) {
      return next(new ErrorHandler("No valid files were uploaded", 400));
    }

    // Add all successfully processed items to the module
    switch (contentType) {
      case "pdf":
        module.pdfs.push(...uploadedContentItems);
        break;
      case "ppt":
        module.ppts.push(...uploadedContentItems);
        break;
      case "video":
        module.videos.push(...uploadedContentItems);
        break;
    }

    console.log("Saving updated syllabus");
    await syllabus.save({ session });
    console.log("Syllabus updated with bulk uploaded content");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(201).json({
      success: true,
      message: `Bulk upload completed successfully. ${uploadedContentItems.length} ${contentType} files uploaded.`,
      contentType,
      uploadedCount: uploadedContentItems.length,
      totalFiles: files.length,
      skippedCount: skippedFiles.length,
      uploadedItems: uploadedContentItems,
      skippedFiles: skippedFiles,
    });
  } catch (error) {
    console.log(`Error in bulkUploadContent: ${error.message}`);

    if (transactionStarted) {
      try {
        console.log("Aborting transaction");
        await session.abortTransaction();
        console.log("Transaction aborted");
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }

    // Clean up uploaded files if transaction failed
    if (uploadedFiles.length > 0) {
      console.log(
        `Cleaning up ${uploadedFiles.length} uploaded files due to error`
      );
      const cleanupPromises = uploadedFiles.map(async (fileKey) => {
        try {
          await deleteFileFromAzure(fileKey);
          console.log(`Cleaned up file: ${fileKey}`);
        } catch (cleanupError) {
          console.error(`Error cleaning up file ${fileKey}:`, cleanupError);
        }
      });
      await Promise.allSettled(cleanupPromises);
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    console.log("Ending session");
    await session.endSession();
    console.log("Session ended");
  }
});

module.exports = exports;
