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

  // Find CourseSyllabus
  const syllabus = await CourseSyllabus.findOne({ course: courseId }).populate({
    path: "modules.lectures",
    model: "Lecture",
    select:
      "title content videoUrl videoKey moduleNumber lectureOrder isReviewed reviewDeadline createdAt updatedAt",
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

      // Sort lectures by order
      lectures: module.lectures
        ? [...module.lectures].sort(
            (a, b) => (a.lectureOrder || 0) - (b.lectureOrder || 0)
          )
        : [],

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

    // Create new module
    const newModule = {
      moduleNumber,
      moduleTitle,
      description: description || "",
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
    path: "modules.lectures",
    model: "Lecture",
    select:
      "title content videoUrl videoKey moduleNumber lectureOrder isReviewed reviewDeadline createdAt updatedAt",
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

    // Sort lectures by order
    lectures: module.lectures
      ? [...module.lectures].sort(
          (a, b) => (a.lectureOrder || 0) - (b.lectureOrder || 0)
        )
      : [],

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
    if (moduleNumber) module.moduleNumber = moduleNumber;
    if (moduleTitle) module.moduleTitle = moduleTitle;
    if (description !== undefined) module.description = description;
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

    // Delete all content files from Azure
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

    // Delete files from Azure
    if (filesToDelete.length > 0) {
      console.log(`Deleting ${filesToDelete.length} files from Azure`);
      for (const fileKey of filesToDelete) {
        try {
          await deleteFileFromAzure(fileKey);
        } catch (azureError) {
          console.error("Error deleting file from Azure:", azureError);
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

// Add content to module (PDF, PPT, Video, or Link)
exports.addModuleContent = catchAsyncErrors(async (req, res, next) => {
  console.log("addModuleContent: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

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
      name: name || "Untitled Content",
      description: description || "",
      createDate: new Date(),
      isActive: true,
      thumbnail: {
        thumbnailUrl: "",
        thumbnailKey: "",
      },
    };

    // Process content based on type
    switch (contentType) {
      case "pdf":
        // Handle PDF upload
        if (!req.files || !req.files.file) {
          return next(new ErrorHandler("No PDF file uploaded", 400));
        }

        try {
          const allowedTypes = ["application/pdf"];
          const { filesArray, uploadedFiles } = await handleFileUploads(
            req.files.file,
            allowedTypes,
            "syllabus-pdfs",
            next
          );

          const file = filesArray[0];
          const uploadedFile = uploadedFiles[0];

          contentItem.fileUrl = uploadedFile.url;
          contentItem.fileKey = uploadedFile.key;
          contentItem.fileName = file.name;
          contentItem.fileSize = file.size;
          contentItem.order = module.pdfs.length + 1;

          module.pdfs.push(contentItem);
        } catch (uploadError) {
          console.error("Error handling PDF upload:", uploadError);
          return next(
            new ErrorHandler(
              uploadError.message || "Failed to upload PDF",
              uploadError.statusCode || 500
            )
          );
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
          const { filesArray, uploadedFiles } = await handleFileUploads(
            req.files.file,
            allowedTypes,
            "syllabus-ppts",
            next
          );

          const file = filesArray[0];
          const uploadedFile = uploadedFiles[0];

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
          return next(
            new ErrorHandler(
              uploadError.message || "Failed to upload PPT",
              uploadError.statusCode || 500
            )
          );
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
          ];
          const { filesArray, uploadedFiles } = await handleFileUploads(
            req.files.file,
            allowedTypes,
            "syllabus-videos",
            next
          );

          const file = filesArray[0];
          const uploadedFile = uploadedFiles[0];

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
          return next(
            new ErrorHandler(
              uploadError.message || "Failed to upload video",
              uploadError.statusCode || 500
            )
          );
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

    // Update basic fields
    if (name) contentItem.name = name;
    if (description !== undefined) contentItem.description = description;

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
            ];
            uploadPath = "syllabus-videos";
            break;
        }

        const { filesArray, uploadedFiles } = await handleFileUploads(
          req.files.file,
          allowedTypes,
          uploadPath,
          next
        );

        const file = filesArray[0];
        const uploadedFile = uploadedFiles[0];

        // Delete old file from Azure
        if (contentItem.fileKey) {
          try {
            await deleteFileFromAzure(contentItem.fileKey);
            console.log(`Deleted old file: ${contentItem.fileKey}`);
          } catch (azureError) {
            console.error("Error deleting old file from Azure:", azureError);
          }
        }

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
        return next(
          new ErrorHandler(
            uploadError.message || "Failed to upload file",
            uploadError.statusCode || 500
          )
        );
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

    // Delete file from Azure if it's a file-based content type
    if (["pdf", "ppt", "video"].includes(contentType) && contentItem.fileKey) {
      try {
        await deleteFileFromAzure(contentItem.fileKey);
        console.log(`Deleted file from Azure: ${contentItem.fileKey}`);
      } catch (azureError) {
        console.error("Error deleting file from Azure:", azureError);
      }

      // Also delete thumbnail if exists
      if (contentItem.thumbnail?.thumbnailKey) {
        try {
          await deleteFileFromAzure(contentItem.thumbnail.thumbnailKey);
          console.log(
            `Deleted thumbnail from Azure: ${contentItem.thumbnail.thumbnailKey}`
          );
        } catch (azureError) {
          console.error("Error deleting thumbnail from Azure:", azureError);
        }
      }
    }

    console.log("Saving updated syllabus");
    await syllabus.save({ session });
    console.log("Content item removed from module");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(200).json({
      success: true,
      message: `${contentType.toUpperCase()} content deleted successfully`,
      courseId: courseId,
      moduleId: moduleId,
      contentType: contentType,
      contentId: contentId,
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
      if (contentIndex !== -1) {
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

module.exports = exports;
