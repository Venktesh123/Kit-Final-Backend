const mongoose = require("mongoose");
const EContent = require("../models/EContent");
const Course = require("../models/Course");
const { ErrorHandler } = require("../middleware/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const {
  uploadFileToAzure,
  deleteFileFromAzure,
} = require("../utils/azureConfig");

// Function to handle file uploads - extracted to avoid code duplication
const handleFileUploads = async (files, allowedTypes, next) => {
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
        `Invalid file type. Allowed types: PDF, PPT, PPTX`,
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
    uploadFileToAzure(file, "econtent-files")
  );

  const uploadedFiles = await Promise.all(uploadPromises);
  console.log(`Successfully uploaded ${uploadedFiles.length} files`);

  return { filesArray, uploadedFiles };
};

// Create file objects from uploaded files
const createFileObjects = (filesArray, uploadedFiles) => {
  const fileObjects = [];

  for (let i = 0; i < filesArray.length; i++) {
    const file = filesArray[i];
    const uploadedFile = uploadedFiles[i];
    const fileName = file.name;

    // Determine file type
    let fileType = "other";
    if (file.mimetype === "application/pdf") {
      fileType = "pdf";
    } else if (file.mimetype === "application/vnd.ms-powerpoint") {
      fileType = "ppt";
    } else if (
      file.mimetype ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ) {
      fileType = "pptx";
    }

    fileObjects.push({
      fileType,
      fileUrl: uploadedFile.url,
      fileKey: uploadedFile.key,
      fileName,
      uploadDate: new Date(),
    });
  }

  return fileObjects;
};

// Create new EContent module
exports.createEContent = catchAsyncErrors(async (req, res, next) => {
  console.log("createEContent: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { moduleNumber, moduleTitle, link } = req.body;
    const { courseId } = req.params;

    console.log(`Creating EContent for course: ${courseId}`);

    // Validate inputs
    if (!moduleNumber || !moduleTitle) {
      console.log("Missing required fields");
      return next(
        new ErrorHandler("Module number and title are required", 400)
      );
    }

    // Check if course exists
    const course = await Course.findById(courseId).session(session);
    if (!course) {
      console.log(`Course not found: ${courseId}`);
      return next(new ErrorHandler("Course not found", 404));
    }
    console.log("Course found");

    // Find existing EContent document for this course or create new one
    let eContent = await EContent.findOne({ course: courseId }).session(
      session
    );

    if (!eContent) {
      console.log("Creating new EContent document");
      eContent = new EContent({
        course: courseId,
        modules: [],
      });
    } else {
      console.log("Found existing EContent document");
    }

    // Create new module object
    const newModule = {
      moduleNumber,
      moduleTitle,
      link: link || "", // Add the link field with default empty string if not provided
      files: [],
    };

    // Handle file uploads if any
    if (req.files && req.files.files) {
      try {
        const allowedTypes = [
          "application/pdf",
          "application/vnd.ms-powerpoint",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ];

        const { filesArray, uploadedFiles } = await handleFileUploads(
          req.files.files,
          allowedTypes,
          next
        );

        const fileObjects = createFileObjects(filesArray, uploadedFiles);

        // Add files to the new module
        newModule.files = fileObjects;
        console.log("Files added to new module");
      } catch (uploadError) {
        console.error("Error handling file uploads:", uploadError);
        return next(
          new ErrorHandler(
            uploadError.message || "Failed to upload files",
            uploadError.statusCode || 500
          )
        );
      }
    }

    // Add new module to eContent
    eContent.modules.push(newModule);

    console.log("Saving eContent");
    await eContent.save({ session });
    console.log(`EContent saved with ID: ${eContent._id}`);

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(201).json({
      success: true,
      message: "EContent module created successfully",
      courseId: courseId,
      eContent,
    });
  } catch (error) {
    console.log(`Error in createEContent: ${error.message}`);

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

// Get EContent for a course
exports.getEContentByCourse = catchAsyncErrors(async (req, res, next) => {
  console.log("getEContentByCourse: Started");
  const { courseId } = req.params;

  console.log(`Fetching EContent for course: ${courseId}`);

  // Check if course exists
  const course = await Course.findById(courseId);
  if (!course) {
    console.log(`Course not found: ${courseId}`);
    return next(new ErrorHandler("Course not found", 404));
  }

  // Find EContent
  const eContent = await EContent.findOne({ course: courseId });
  if (!eContent) {
    console.log(`No EContent found for course: ${courseId}`);
    // Just return an empty result instead of an error
    return res.status(200).json({
      success: true,
      courseId: courseId,
      eContent: { course: courseId, modules: [] },
    });
  }

  res.status(200).json({
    success: true,
    courseId: courseId,
    eContent,
  });
});

// Get specific module by ID
exports.getModuleById = catchAsyncErrors(async (req, res, next) => {
  console.log("getModuleById: Started");
  const { courseId, moduleId } = req.params;

  console.log(`Fetching module ${moduleId} for course: ${courseId}`);

  // Find EContent
  const eContent = await EContent.findOne({ course: courseId });
  if (!eContent) {
    console.log(`No EContent found for course: ${courseId}`);
    return next(new ErrorHandler("No EContent found for this course", 404));
  }

  // Find specific module
  const module = eContent.modules.id(moduleId);
  if (!module) {
    console.log(`Module not found: ${moduleId}`);
    return next(new ErrorHandler("Module not found", 404));
  }

  res.status(200).json({
    success: true,
    courseId: courseId,
    moduleId: moduleId,
    module,
  });
});

// Update module
exports.updateModule = catchAsyncErrors(async (req, res, next) => {
  console.log("updateModule: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;
  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");
    const { moduleNumber, moduleTitle, link } = req.body;
    const { courseId, moduleId } = req.params;
    console.log(`Updating module ${moduleId} for course: ${courseId}`);
    // Find EContent
    const eContent = await EContent.findOne({ course: courseId }).session(
      session
    );
    if (!eContent) {
      console.log(`No EContent found for course: ${courseId}`);
      return next(new ErrorHandler("No EContent found for this course", 404));
    }
    // Find specific module
    const module = eContent.modules.id(moduleId);
    if (!module) {
      console.log(`Module not found: ${moduleId}`);
      return next(new ErrorHandler("Module not found", 404));
    }
    // Update module details
    if (moduleNumber) {
      module.moduleNumber = moduleNumber;
    }
    if (moduleTitle) module.moduleTitle = moduleTitle;
    // Update link if provided
    if (link !== undefined) {
      module.link = link;
    }
    // Handle file uploads if any
    if (req.files && req.files.files) {
      try {
        const allowedTypes = [
          "application/pdf",
          "application/vnd.ms-powerpoint",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ];
        const { filesArray, uploadedFiles } = await handleFileUploads(
          req.files.files,
          allowedTypes,
          next
        );
        const fileObjects = createFileObjects(filesArray, uploadedFiles);
        // Add files to the module
        module.files.push(...fileObjects);
        console.log("New files added to module");
      } catch (uploadError) {
        console.error("Error handling file uploads:", uploadError);
        return next(
          new ErrorHandler(
            uploadError.message || "Failed to upload files",
            uploadError.statusCode || 500
          )
        );
      }
    }
    console.log("Saving updated eContent");
    await eContent.save({ session });
    console.log("EContent updated");
    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");
    res.status(200).json({
      success: true,
      message: "Module updated successfully",
      courseId: courseId,
      moduleId: moduleId,
      module: eContent.modules.id(moduleId),
    });
  } catch (error) {
    console.log(`Error in updateModule: ${error.message}`);
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

    // Find EContent
    const eContent = await EContent.findOne({ course: courseId }).session(
      session
    );
    if (!eContent) {
      console.log(`No EContent found for course: ${courseId}`);
      return next(new ErrorHandler("No EContent found for this course", 404));
    }

    // Find specific module
    const module = eContent.modules.id(moduleId);
    if (!module) {
      console.log(`Module not found: ${moduleId}`);
      return next(new ErrorHandler("Module not found", 404));
    }

    // Delete all module files from Azure if there are any
    if (module.files && module.files.length > 0) {
      console.log(`Deleting ${module.files.length} files from Azure`);

      try {
        const deletePromises = module.files.map((file) =>
          deleteFileFromAzure(file.fileKey)
        );

        await Promise.all(deletePromises);
        console.log("All files deleted from Azure");
      } catch (azureError) {
        console.error("Error deleting files from Azure:", azureError);
        // Continue with the database deletion even if Azure deletion fails
      }
    }

    // Remove module
    eContent.modules.pull({ _id: moduleId });

    console.log("Saving updated eContent");
    await eContent.save({ session });
    console.log("Module removed");

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

// Delete file from module
exports.deleteFile = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteFile: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { courseId, moduleId, fileId } = req.params;

    console.log(
      `Deleting file ${fileId} from module ${moduleId} for course: ${courseId}`
    );

    // Find EContent
    const eContent = await EContent.findOne({ course: courseId }).session(
      session
    );
    if (!eContent) {
      console.log(`No EContent found for course: ${courseId}`);
      return next(new ErrorHandler("No EContent found for this course", 404));
    }

    // Find specific module
    const module = eContent.modules.id(moduleId);
    if (!module) {
      console.log(`Module not found: ${moduleId}`);
      return next(new ErrorHandler("Module not found", 404));
    }

    // Find the file
    const fileIndex = module.files.findIndex(
      (file) => file._id.toString() === fileId
    );
    if (fileIndex === -1) {
      console.log(`File not found: ${fileId}`);
      return next(new ErrorHandler("File not found", 404));
    }

    // Get file key for Azure deletion
    const fileKey = module.files[fileIndex].fileKey;

    // Delete from Azure if needed
    try {
      console.log(`Deleting file from Azure: ${fileKey}`);
      await deleteFileFromAzure(fileKey);
      console.log("File deleted from Azure");
    } catch (azureError) {
      console.error("Error deleting file from Azure:", azureError);
      // Continue with the database deletion even if Azure deletion fails
    }

    // Remove file from module
    module.files.splice(fileIndex, 1);

    console.log("Saving updated eContent");
    await eContent.save({ session });
    console.log("File removed from module");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(200).json({
      success: true,
      message: "File deleted successfully",
      courseId: courseId,
      moduleId: moduleId,
      fileId: fileId,
    });
  } catch (error) {
    console.log(`Error in deleteFile: ${error.message}`);

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
