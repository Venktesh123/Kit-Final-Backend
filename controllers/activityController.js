const Activity = require("../models/Activity");
const Course = require("../models/Course");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const mongoose = require("mongoose");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { ErrorHandler } = require("../middleware/errorHandler");
const {
  uploadFileToAzure,
  deleteFileFromAzure,
} = require("../utils/azureConfig");

// Create new activity
exports.createActivity = catchAsyncErrors(async (req, res, next) => {
  console.log("createActivity: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { title, description, dueDate, totalPoints, links } = req.body;
    const { courseId } = req.params; // Extract courseId from URL

    console.log(`Creating activity for course: ${courseId}`);

    // Validate inputs
    if (!title || !description || !dueDate || !totalPoints) {
      console.log("Missing required fields");
      return next(new ErrorHandler("All fields are required", 400));
    }

    // Check if course exists
    const course = await Course.findById(courseId).session(session);
    if (!course) {
      console.log(`Course not found: ${courseId}`);
      return next(new ErrorHandler("Course not found", 404));
    }
    console.log("Course found");

    // Create activity object
    const activity = new Activity({
      title,
      description,
      course: courseId,
      dueDate,
      totalPoints,
      isActive: true, // Default value
      links: links || [],
    });

    // Handle file uploads if any
    if (req.files && req.files.attachments) {
      console.log("Processing file attachments");

      let attachmentsArray = Array.isArray(req.files.attachments)
        ? req.files.attachments
        : [req.files.attachments];

      console.log(`Found ${attachmentsArray.length} attachments`);

      // Validate file types
      const allowedTypes = [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/jpg",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ];

      for (const file of attachmentsArray) {
        console.log(
          `Validating file: ${file.name}, type: ${file.mimetype}, size: ${file.size}`
        );

        if (!allowedTypes.includes(file.mimetype)) {
          console.log(`Invalid file type: ${file.mimetype}`);
          return next(
            new ErrorHandler(
              `Invalid file type. Allowed types: PDF, JPEG, PNG, DOC, DOCX, XLS, XLSX`,
              400
            )
          );
        }

        // Validate file size (5MB)
        if (file.size > 5 * 1024 * 1024) {
          console.log(`File too large: ${file.size} bytes`);
          return next(
            new ErrorHandler(`File too large. Maximum size allowed is 5MB`, 400)
          );
        }
      }

      // Upload attachments to Azure
      try {
        console.log("Starting file uploads to Azure");

        const uploadPath = `activities/course-${courseId}`;
        const uploadPromises = attachmentsArray.map((file) =>
          uploadFileToAzure(file, uploadPath)
        );

        const uploadedFiles = await Promise.all(uploadPromises);
        console.log(`Successfully uploaded ${uploadedFiles.length} files`);

        // Add attachments to activity
        activity.attachments = uploadedFiles.map((uploadResult) => ({
          name: uploadResult.originalName,
          url: uploadResult.url,
          key: uploadResult.key,
        }));

        console.log("Attachments added to activity");
      } catch (uploadError) {
        console.error("Error uploading files:", uploadError);
        return next(new ErrorHandler("Failed to upload files", 500));
      }
    }

    console.log("Saving activity");
    await activity.save({ session });
    console.log(`Activity saved with ID: ${activity._id}`);

    // Add activity to course's activities array
    course.activities = course.activities || [];
    course.activities.push(activity._id);
    console.log("Updating course with new activity");
    await course.save({ session });
    console.log("Course updated");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(201).json({
      success: true,
      message: "Activity created successfully",
      activity,
    });
  } catch (error) {
    console.log(`Error in createActivity: ${error.message}`);

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

// Submit activity (for students)
exports.submitActivity = catchAsyncErrors(async (req, res, next) => {
  console.log("submitActivity: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    // Verify student permissions
    const student = await Student.findOne({ user: req.user.id }).populate(
      "user",
      "name email"
    );

    if (!student) {
      console.log("Student not found");
      return next(new ErrorHandler("Student not found", 404));
    }
    console.log("Student found:", student._id);

    // Get the activity
    const activity = await Activity.findById(req.params.activityId);
    if (!activity) {
      console.log("Activity not found");
      return next(new ErrorHandler("Activity not found", 404));
    }
    console.log("Activity found:", activity._id);

    // Check if the student is enrolled in the course
    const course = await Course.findById(activity.course);
    if (!course) {
      console.log("Course not found");
      return next(new ErrorHandler("Course not found", 404));
    }

    const isEnrolled = student.courses.some((id) => id.equals(course._id));
    if (!isEnrolled) {
      console.log("Student not enrolled in course");
      return next(new ErrorHandler("Not enrolled in this course", 403));
    }
    console.log("Student is enrolled in the course");

    // Check if the activity is active
    if (!activity.isActive) {
      console.log("Activity not active");
      return next(
        new ErrorHandler(
          "This activity is no longer accepting submissions",
          400
        )
      );
    }

    // Check if file is provided
    if (!req.files || !req.files.submissionFile) {
      console.log("No submission file provided");
      return next(new ErrorHandler("Please upload your submission file", 400));
    }

    const submissionFile = req.files.submissionFile;
    console.log("Submission file details:", {
      name: submissionFile.name,
      size: submissionFile.size,
      mimetype: submissionFile.mimetype,
    });

    // Validate file type
    const validFileTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/jpeg",
      "image/png",
      "application/zip",
      "application/x-zip-compressed",
    ];

    if (!validFileTypes.includes(submissionFile.mimetype)) {
      console.log("Invalid file type:", submissionFile.mimetype);
      return next(
        new ErrorHandler(
          "Invalid file type. Please upload a valid document.",
          400
        )
      );
    }

    // Check if past due date
    const now = new Date();
    const isDueDatePassed = now > activity.dueDate;
    console.log("Is submission late:", isDueDatePassed);

    try {
      // Upload submission to Azure
      console.log("Attempting Azure upload");
      const uploadPath = `activity-submissions/activity-${activity._id}/student-${student._id}`;
      const uploadResult = await uploadFileToAzure(submissionFile, uploadPath);
      console.log("Azure upload successful:", uploadResult.url);

      // Check if already submitted
      const existingSubmission = activity.submissions.find((sub) =>
        sub.student.equals(student._id)
      );

      if (existingSubmission) {
        console.log("Updating existing submission");
        // Delete old file if it exists
        if (existingSubmission.submissionFileKey) {
          try {
            await deleteFileFromAzure(existingSubmission.submissionFileKey);
          } catch (deleteError) {
            console.error("Error deleting old submission file:", deleteError);
          }
        }

        // Update existing submission
        existingSubmission.submissionFile = uploadResult.url;
        existingSubmission.submissionFileKey = uploadResult.key;
        existingSubmission.submissionDate = now;
        existingSubmission.status = "submitted";
        existingSubmission.isLate = isDueDatePassed;
      } else {
        console.log("Creating new submission");
        // Create new submission
        activity.submissions.push({
          student: student._id,
          submissionFile: uploadResult.url,
          submissionFileKey: uploadResult.key,
          submissionDate: now,
          status: "submitted",
          isLate: isDueDatePassed,
        });
      }

      console.log("Saving activity");
      await activity.save({ session });
      console.log("Activity saved successfully");

      console.log("Committing transaction");
      await session.commitTransaction();
      transactionStarted = false;
      console.log("Transaction committed");

      res.json({
        success: true,
        message: "Activity submitted successfully",
        isLate: isDueDatePassed,
      });
    } catch (uploadError) {
      console.log("Error during file upload:", uploadError.message);
      throw new Error(`File upload failed: ${uploadError.message}`);
    }
  } catch (error) {
    console.log("Error in submitActivity:", error.message);

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

// Grade a submission (for teachers)
exports.gradeSubmission = catchAsyncErrors(async (req, res, next) => {
  console.log("gradeSubmission: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    // Verify teacher permissions
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }
    console.log("Teacher found:", teacher._id);

    // Get the activity
    const activity = await Activity.findById(req.params.activityId);
    if (!activity) {
      console.log("Activity not found");
      return next(new ErrorHandler("Activity not found", 404));
    }
    console.log("Activity found:", activity._id);

    // Check if the teacher owns the course
    const course = await Course.findOne({
      _id: activity.course,
      teacher: teacher._id,
    });

    if (!course) {
      console.log("Teacher not authorized for this course");
      return next(new ErrorHandler("Unauthorized to grade this activity", 403));
    }
    console.log("Teacher authorized for course:", course._id);

    const { grade, feedback } = req.body;
    console.log(
      `Grading with: ${grade} points, feedback: ${
        feedback ? "provided" : "not provided"
      }`
    );

    if (!grade || grade < 0 || grade > activity.totalPoints) {
      console.log(
        `Invalid grade: ${grade}, total points: ${activity.totalPoints}`
      );
      return next(
        new ErrorHandler(
          `Grade must be between 0 and ${activity.totalPoints}`,
          400
        )
      );
    }

    // Find the submission
    const submissionIndex = activity.submissions.findIndex(
      (sub) => sub._id.toString() === req.params.submissionId
    );

    if (submissionIndex === -1) {
      console.log(`Submission not found: ${req.params.submissionId}`);
      return next(new ErrorHandler("Submission not found", 404));
    }
    console.log("Submission found at index:", submissionIndex);

    // Update grade and feedback
    activity.submissions[submissionIndex].grade = grade;
    activity.submissions[submissionIndex].feedback = feedback;
    activity.submissions[submissionIndex].status = "graded";
    console.log("Submission updated with grade and feedback");

    console.log("Saving activity");
    await activity.save({ session });
    console.log("Activity saved with graded submission");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.json({
      success: true,
      message: "Submission graded successfully",
    });
  } catch (error) {
    console.log("Error in gradeSubmission:", error.message);

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

// Get all activities for a course
exports.getCourseActivities = catchAsyncErrors(async (req, res, next) => {
  console.log("getCourseActivities: Started");
  try {
    // Get the course ID from request parameters
    const { courseId } = req.params;
    console.log(`Fetching activities for course: ${courseId}`);

    // Find the course
    const course = await Course.findById(courseId);
    if (!course) {
      console.log("Course not found");
      return next(new ErrorHandler("Course not found", 404));
    }
    console.log("Course found");

    // Verify that the user has access to this course
    if (req.user.role === "teacher") {
      console.log("Verifying teacher access");
      const teacher = await Teacher.findOne({ user: req.user.id });
      if (!teacher || !course.teacher.equals(teacher._id)) {
        console.log("Teacher not authorized for this course");
        return next(new ErrorHandler("Unauthorized access", 403));
      }
      console.log("Teacher authorized");
    } else if (req.user.role === "student") {
      console.log("Verifying student access");
      const student = await Student.findOne({ user: req.user.id });
      if (!student || !student.courses.some((id) => id.equals(course._id))) {
        console.log("Student not enrolled in this course");
        return next(new ErrorHandler("Unauthorized access", 403));
      }
      console.log("Student authorized");
    }

    // Find all activities for this course
    console.log("Fetching activities");
    const activities = await Activity.find({ course: courseId }).sort({
      dueDate: 1,
    });
    console.log(`Found ${activities.length} activities`);

    // Filter submissions for students (they should only see their own)
    if (req.user.role === "student") {
      console.log("Filtering submissions for student");
      const student = await Student.findOne({ user: req.user.id });

      activities.forEach((activity) => {
        activity.submissions = activity.submissions.filter((submission) =>
          submission.student.equals(student._id)
        );
      });
      console.log("Submissions filtered");
    }

    res.status(200).json({
      success: true,
      activities,
    });
  } catch (error) {
    console.log("Error in getCourseActivities:", error.message);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Get a specific activity by ID
exports.getActivityById = catchAsyncErrors(async (req, res, next) => {
  console.log("getActivityById: Started");
  try {
    const { activityId } = req.params;
    console.log(`Fetching activity: ${activityId}`);

    // Find the activity with course information
    const activity = await Activity.findById(activityId).populate(
      "course",
      "title"
    );

    if (!activity) {
      console.log("Activity not found");
      return next(new ErrorHandler("Activity not found", 404));
    }
    console.log("Activity found");

    // Verify that the user has access to this activity's course
    if (req.user.role === "teacher") {
      console.log("Verifying teacher access");
      const teacher = await Teacher.findOne({ user: req.user.id });
      const course = await Course.findById(activity.course);

      if (!teacher || !course.teacher.equals(teacher._id)) {
        console.log("Teacher not authorized for this course");
        return next(new ErrorHandler("Unauthorized access", 403));
      }
      console.log("Teacher authorized");
    } else if (req.user.role === "student") {
      console.log("Verifying student access");
      const student = await Student.findOne({ user: req.user.id });

      // Check if student is enrolled in the course
      if (
        !student ||
        !student.courses.some((id) => id.equals(activity.course._id))
      ) {
        console.log("Student not enrolled in this course");
        return next(new ErrorHandler("Unauthorized access", 403));
      }
      console.log("Student authorized");

      // Replace the student ID with req.user.id in each submission for this student
      activity.submissions = activity.submissions
        .filter((submission) => submission.student.equals(student._id))
        .map((submission) => {
          // Create a new object to avoid modifying the original
          const modifiedSubmission = {
            ...submission.toObject(), // Convert to plain object if it's a Mongoose document
            student: req.user.id, // Replace student field with req.user.id
          };
          return modifiedSubmission;
        });

      console.log("Submissions modified for student");
    }

    res.status(200).json({
      success: true,
      activity,
    });
  } catch (error) {
    console.log("Error in getActivityById:", error.message);
    return next(new ErrorHandler(error.message, 500));
  }
});

exports.updateActivity = catchAsyncErrors(async (req, res, next) => {
  console.log("updateActivity: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { activityId } = req.params;
    console.log(`Updating activity: ${activityId}`);

    // Verify teacher permissions
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }
    console.log("Teacher found:", teacher._id);

    // Get the activity
    const activity = await Activity.findById(activityId);
    if (!activity) {
      console.log("Activity not found");
      return next(new ErrorHandler("Activity not found", 404));
    }
    console.log("Activity found:", activity._id);

    // Check if the teacher owns the course
    const course = await Course.findOne({
      _id: activity.course,
      teacher: teacher._id,
    });

    if (!course) {
      console.log("Teacher not authorized for this course");
      return next(
        new ErrorHandler("Unauthorized to update this activity", 403)
      );
    }
    console.log("Teacher authorized for course:", course._id);

    // Extract update fields
    const { title, description, dueDate, totalPoints, isActive, links } =
      req.body;

    // Update activity fields if provided
    if (title) activity.title = title;
    if (description) activity.description = description;
    if (dueDate) activity.dueDate = dueDate;
    if (totalPoints) activity.totalPoints = totalPoints;
    if (isActive !== undefined) activity.isActive = isActive;
    if (links?.length !== 0) activity.links = links;

    // Handle file uploads if any
    if (req.files && req.files.attachments) {
      console.log("Processing new file attachments");

      let attachmentsArray = Array.isArray(req.files.attachments)
        ? req.files.attachments
        : [req.files.attachments];

      console.log(`Found ${attachmentsArray.length} new attachments`);

      // Validate file types
      const allowedTypes = [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/jpg",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ];

      for (const file of attachmentsArray) {
        console.log(
          `Validating file: ${file.name}, type: ${file.mimetype}, size: ${file.size}`
        );

        if (!allowedTypes.includes(file.mimetype)) {
          console.log(`Invalid file type: ${file.mimetype}`);
          return next(
            new ErrorHandler(
              `Invalid file type. Allowed types: PDF, JPEG, PNG, DOC, DOCX, XLS, XLSX`,
              400
            )
          );
        }

        // Validate file size (5MB)
        if (file.size > 5 * 1024 * 1024) {
          console.log(`File too large: ${file.size} bytes`);
          return next(
            new ErrorHandler(`File too large. Maximum size allowed is 5MB`, 400)
          );
        }
      }

      // Upload new attachments to Azure
      try {
        console.log("Starting file uploads to Azure");

        const uploadPath = `activities/course-${activity.course}`;
        const uploadPromises = attachmentsArray.map((file) =>
          uploadFileToAzure(file, uploadPath)
        );

        const uploadedFiles = await Promise.all(uploadPromises);
        console.log(`Successfully uploaded ${uploadedFiles.length} files`);

        // Handle attachment replacement options
        const { replaceAttachments } = req.body;

        if (replaceAttachments === "true") {
          // Delete old attachments from Azure
          if (activity.attachments && activity.attachments.length > 0) {
            const deletePromises = activity.attachments.map((attachment) =>
              deleteFileFromAzure(attachment.key).catch((err) =>
                console.error("Error deleting old attachment:", err)
              )
            );
            await Promise.all(deletePromises);
          }

          // Replace all existing attachments
          activity.attachments = uploadedFiles.map((uploadResult) => ({
            name: uploadResult.originalName,
            url: uploadResult.url,
            key: uploadResult.key,
          }));
          console.log("Replaced all attachments");
        } else {
          // Append new attachments to existing ones
          const newAttachments = uploadedFiles.map((uploadResult) => ({
            name: uploadResult.originalName,
            url: uploadResult.url,
            key: uploadResult.key,
          }));

          activity.attachments = [...activity.attachments, ...newAttachments];
          console.log("Added new attachments to existing ones");
        }
      } catch (uploadError) {
        console.error("Error uploading files:", uploadError);
        return next(new ErrorHandler("Failed to upload files", 500));
      }
    }

    // Remove specific attachments if requested
    if (req.body.removeAttachments) {
      const attachmentsToRemove = Array.isArray(req.body.removeAttachments)
        ? req.body.removeAttachments
        : [req.body.removeAttachments];

      console.log(`Removing ${attachmentsToRemove.length} attachments`);

      // Delete files from Azure
      const deletePromises = activity.attachments
        .filter((attachment) =>
          attachmentsToRemove.includes(attachment._id.toString())
        )
        .map((attachment) =>
          deleteFileFromAzure(attachment.key).catch((err) =>
            console.error("Error deleting attachment:", err)
          )
        );

      await Promise.all(deletePromises);

      activity.attachments = activity.attachments.filter(
        (attachment) => !attachmentsToRemove.includes(attachment._id.toString())
      );

      console.log("Attachments removed");
    }

    console.log("Saving updated activity");
    await activity.save({ session });
    console.log("Activity updated successfully");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(200).json({
      success: true,
      message: "Activity updated successfully",
      activity,
    });
  } catch (error) {
    console.log(`Error in updateActivity: ${error.message}`);

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

// Delete activity
exports.deleteActivity = catchAsyncErrors(async (req, res, next) => {
  console.log("deleteActivity: Started");
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    console.log("Transaction started");

    const { activityId } = req.params;
    console.log(`Deleting activity: ${activityId}`);

    // Verify teacher permissions
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      console.log("Teacher not found");
      return next(new ErrorHandler("Teacher not found", 404));
    }
    console.log("Teacher found:", teacher._id);

    // Get the activity
    const activity = await Activity.findById(activityId);
    if (!activity) {
      console.log("Activity not found");
      return next(new ErrorHandler("Activity not found", 404));
    }
    console.log("Activity found:", activity._id);

    // Get the course and verify ownership
    const course = await Course.findOne({
      _id: activity.course,
      teacher: teacher._id,
    });

    if (!course) {
      console.log("Teacher not authorized for this course");
      return next(
        new ErrorHandler("Unauthorized to delete this activity", 403)
      );
    }
    console.log("Teacher authorized for course:", course._id);

    // Delete attachment files from Azure
    if (activity.attachments && activity.attachments.length > 0) {
      console.log(
        `Deleting ${activity.attachments.length} attachment files from Azure`
      );
      const deleteAttachmentPromises = activity.attachments.map((attachment) =>
        deleteFileFromAzure(attachment.key).catch((err) =>
          console.error("Error deleting attachment:", err)
        )
      );
      await Promise.all(deleteAttachmentPromises);
    }

    // Delete submission files from Azure
    if (activity.submissions && activity.submissions.length > 0) {
      console.log(
        `Deleting ${activity.submissions.length} submission files from Azure`
      );
      const deleteSubmissionPromises = activity.submissions
        .filter((submission) => submission.submissionFileKey)
        .map((submission) =>
          deleteFileFromAzure(submission.submissionFileKey).catch((err) =>
            console.error("Error deleting submission:", err)
          )
        );
      await Promise.all(deleteSubmissionPromises);
    }

    // Remove activity from course
    console.log("Removing activity from course");
    course.activities = course.activities.filter(
      (id) => !id.equals(activity._id)
    );
    await course.save({ session });
    console.log("Course updated");

    // Delete the activity
    console.log("Deleting activity document");
    await Activity.findByIdAndDelete(activityId).session(session);
    console.log("Activity deleted");

    console.log("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    console.log("Transaction committed");

    res.status(200).json({
      success: true,
      message: "Activity deleted successfully",
    });
  } catch (error) {
    console.log(`Error in deleteActivity: ${error.message}`);

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
