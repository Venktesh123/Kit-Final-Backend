const mongoose = require("mongoose");
const Announcement = require("../models/Announcement");
const Course = require("../models/Course");
const Teacher = require("../models/Teacher");
const { ErrorHandler } = require("../middleware/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const {
  uploadFileToAzure,
  deleteFileFromAzure,
} = require("../utils/azureConfig");

// Create new announcement
exports.createAnnouncement = catchAsyncErrors(async (req, res, next) => {
  console.log("createAnnouncement: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { title, content, publishDate } = req.body;
    const { courseId } = req.params;

    console.log(`Creating announcement for course: ${courseId}`);

    // Validate inputs
    if (!title || !content) {
      console.log("Missing required fields");
      return next(new ErrorHandler("Title and content are required", 400));
    }

    // Check if course exists
    const course = await Course.findById(courseId).session(session);
    if (!course) {
      console.log(`Course not found: ${courseId}`);
      return next(new ErrorHandler("Course not found", 404));
    }
    console.log("Course found");

    // Find the teacher
    const teacher = await Teacher.findOne({ user: req.user._id }).session(
      session
    );
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    // Create new announcement object
    const announcement = new Announcement({
      course: courseId,
      title,
      content,
      publishDate: publishDate || new Date(),
      publishedBy: teacher._id,
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
              `Invalid file type. Allowed types: JPG, PNG, GIF`,
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
          "announcement-images"
        );
        announcement.image.imageUrl = uploadedImage.url;
        announcement.image.imageKey = uploadedImage.key;
        console.log("Image added to announcement");
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

    // Save announcement
    console.log("Saving announcement");
    await announcement.save({ session });
    console.log(`Announcement saved with ID: ${announcement._id}`);

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(201).json({
      success: true,
      message: "Announcement created successfully",
      announcement,
    });
  } catch (error) {
    console.log(`Error in createAnnouncement: ${error.message}`);

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

// Get all announcements for a course
exports.getCourseAnnouncements = catchAsyncErrors(async (req, res, next) => {
  console.log("getCourseAnnouncements: Started");
  const { courseId } = req.params;

  console.log(`Fetching announcements for course: ${courseId}`);

  // Find announcements
  let announcements = await Announcement.find({
    course: courseId,
    isActive: true,
  })
    .sort({ publishDate: -1 })
    .populate({
      path: "publishedBy",
      populate: {
        path: "user",
        select: "name email", // Explicitly select only these fields from user
      },
    });

  if (announcements.length === 0) {
    console.log(`No announcements found for course: ${courseId}`);
    return res.status(200).json({
      success: true,
      announcements: [],
    });
  }

  // Deep transform to remove courses field from publishedBy object
  const transformedAnnouncements = announcements.map((announcement) => {
    const obj = announcement.toObject();

    // If there's a publishedBy field with a courses array, remove it
    if (obj.publishedBy && obj.publishedBy.courses) {
      delete obj.publishedBy.courses;
    }

    // Also handle if publishedBy.user has courses
    if (
      obj.publishedBy &&
      obj.publishedBy.user &&
      obj.publishedBy.user.courses
    ) {
      delete obj.publishedBy.user.courses;
    }

    return obj;
  });

  res.status(200).json({
    success: true,
    count: transformedAnnouncements.length,
    announcements: transformedAnnouncements,
  });
});

// Get specific announcement by ID
exports.getAnnouncementById = catchAsyncErrors(async (req, res, next) => {
  console.log("getAnnouncementById: Started");
  const { courseId, announcementId } = req.params;

  console.log(
    `Fetching announcement ${announcementId} for course: ${courseId}`
  );

  // Find announcement
  const announcement = await Announcement.findOne({
    _id: announcementId,
    course: courseId,
  }).populate({
    path: "publishedBy",
    populate: {
      path: "user",
      select: "name email",
    },
  });

  if (!announcement) {
    console.log(`Announcement not found: ${announcementId}`);
    return next(new ErrorHandler("Announcement not found", 404));
  }

  res.status(200).json({
    success: true,
    announcement,
  });
});

// Update announcement
exports.updateAnnouncement = catchAsyncErrors(async (req, res, next) => {
  console.log("updateAnnouncement: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { title, content, publishDate, isActive } = req.body;
    const { courseId, announcementId } = req.params;

    console.log(
      `Updating announcement ${announcementId} for course: ${courseId}`
    );

    // Find announcement
    const announcement = await Announcement.findOne({
      _id: announcementId,
      course: courseId,
    }).session(session);

    if (!announcement) {
      console.log(`Announcement not found: ${announcementId}`);
      return next(new ErrorHandler("Announcement not found", 404));
    }

    // Verify teacher owns this course
    const teacher = await Teacher.findOne({ user: req.user._id }).session(
      session
    );
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    // Check if the teacher is the publisher or owns the course
    const course = await Course.findById(courseId).session(session);
    if (!course || course.teacher.toString() !== teacher._id.toString()) {
      console.log("Unauthorized - Teacher does not own this course");
      return next(new ErrorHandler("Unauthorized", 403));
    }

    // Update announcement details
    if (title) announcement.title = title;
    if (content) announcement.content = content;
    if (publishDate) announcement.publishDate = publishDate;
    if (isActive !== undefined) announcement.isActive = isActive;

    // Handle image upload if any
    if (req.files && req.files.image) {
      try {
        const imageFile = req.files.image;
        console.log(
          `Processing new image: ${imageFile.name}, type: ${imageFile.mimetype}, size: ${imageFile.size}`
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
              `Invalid file type. Allowed types: JPG, PNG, GIF`,
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

        // Delete old image from Azure if it exists
        if (announcement.image && announcement.image.imageKey) {
          try {
            await deleteFileFromAzure(announcement.image.imageKey);
            console.log("Old image deleted from Azure");
          } catch (azureError) {
            console.error("Error deleting image from Azure:", azureError);
            // Continue with the update even if Azure deletion fails
          }
        }

        // Upload new image to Azure
        const uploadedImage = await uploadFileToAzure(
          imageFile,
          "announcement-images"
        );
        announcement.image.imageUrl = uploadedImage.url;
        announcement.image.imageKey = uploadedImage.key;
        console.log("New image added to announcement");
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

    // Remove image if removeImage flag is set
    if (
      req.body.removeImage === "true" &&
      announcement.image &&
      announcement.image.imageKey
    ) {
      try {
        await deleteFileFromAzure(announcement.image.imageKey);
        console.log("Image deleted from Azure");

        // Clear image fields
        announcement.image.imageUrl = "";
        announcement.image.imageKey = "";
      } catch (azureError) {
        console.error("Error deleting image from Azure:", azureError);
        // Continue with the update even if Azure deletion fails
      }
    }

    console.log("Saving updated announcement");
    await announcement.save({ session });
    console.log("Announcement updated");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(200).json({
      success: true,
      message: "Announcement updated successfully",
      announcement,
    });
  } catch (error) {
    console.log(`Error in updateAnnouncement: ${error.message}`);

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

// Delete announcement
exports.deleteAnnouncement = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteAnnouncement: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { courseId, announcementId } = req.params;

    console.log(
      `Deleting announcement ${announcementId} for course: ${courseId}`
    );

    // Find announcement
    const announcement = await Announcement.findOne({
      _id: announcementId,
      course: courseId,
    }).session(session);

    if (!announcement) {
      console.log(`Announcement not found: ${announcementId}`);
      return next(new ErrorHandler("Announcement not found", 404));
    }

    // Verify teacher owns this course
    const teacher = await Teacher.findOne({ user: req.user._id }).session(
      session
    );
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }

    // Check if the teacher is the publisher or owns the course
    const course = await Course.findById(courseId).session(session);
    if (!course || course.teacher.toString() !== teacher._id.toString()) {
      console.log("Unauthorized - Teacher does not own this course");
      return next(new ErrorHandler("Unauthorized", 403));
    }

    // Delete image from Azure if it exists
    if (announcement.image && announcement.image.imageKey) {
      try {
        await deleteFileFromAzure(announcement.image.imageKey);
        console.log("Image deleted from Azure");
      } catch (azureError) {
        console.error("Error deleting image from Azure:", azureError);
        // Continue with deletion even if Azure deletion fails
      }
    }

    // Delete the announcement
    await Announcement.deleteOne({ _id: announcementId }).session(session);
    console.log("Announcement deleted");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(200).json({
      success: true,
      message: "Announcement deleted successfully",
    });
  } catch (error) {
    console.log(`Error in deleteAnnouncement: ${error.message}`);

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
