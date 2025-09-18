const Course = require("../models/Course");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const CourseOutcome = require("../models/CourseOutcome");
const CourseSchedule = require("../models/CourseSchedule");
const CourseSyllabus = require("../models/CourseSyllabus");
const WeeklyPlan = require("../models/WeeklyPlan");
const CreditPoints = require("../models/CreditPoints");
const CourseAttendance = require("../models/CourseAttendance");
const Lecture = require("../models/Lecture");
const Assignment = require("../models/Assignment");
const Announcement = require("../models/Announcement");
const Discussion = require("../models/Discussion");
const EContent = require("../models/EContent");
const mongoose = require("mongoose");
const { ErrorHandler } = require("../middleware/errorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { deleteFileFromAzure } = require("../utils/azureConfig");

// Better logging setup
const logger = {
  info: (message) => console.log(`[ADMIN-COURSE-INFO] ${message}`),
  error: (message, error) =>
    console.error(`[ADMIN-COURSE-ERROR] ${message}`, error),
};

// Helper function to format course response with teacher info
const formatCourseResponse = async (course) => {
  const populatedCourse = await Course.findById(course._id)
    .populate("semester", "name startDate endDate")
    .populate("outcomes", "outcomes")
    .populate(
      "schedule",
      "classStartDate classEndDate midSemesterExamDate endSemesterExamDate classDaysAndTimes"
    )
    .populate("syllabus")
    .populate("weeklyPlan", "weeks")
    .populate("creditPoints", "lecture tutorial practical project")
    .populate("attendance", "sessions")
    .populate({
      path: "teacher",
      populate: {
        path: "user",
        select: "name email mobileNo gender ageAsOn2025",
      },
    });

  // Get course statistics
  const [
    lectureCount,
    assignmentCount,
    announcementCount,
    enrolledStudentsCount,
  ] = await Promise.all([
    Lecture.countDocuments({ course: course._id, isActive: true }),
    Assignment.countDocuments({ course: course._id, isActive: true }),
    Announcement.countDocuments({ course: course._id, isActive: true }),
    Student.countDocuments({
      courses: course._id,
      courseCodes: course.courseCode,
    }),
  ]);

  return {
    _id: populatedCourse._id,
    title: populatedCourse.title,
    aboutCourse: populatedCourse.aboutCourse,
    courseCode: populatedCourse.courseCode,
    isActive: populatedCourse.isActive,

    // Teacher information
    teacher: {
      _id: populatedCourse.teacher._id,
      name: populatedCourse.teacher.user?.name || "Unknown",
      email: populatedCourse.teacher.email,
      mobileNo: populatedCourse.teacher.user?.mobileNo || "",
      gender: populatedCourse.teacher.user?.gender || "",
      age: populatedCourse.teacher.user?.ageAsOn2025 || null,
      courseCodes: populatedCourse.teacher.courseCodes,
    },

    // Semester info
    semester: populatedCourse.semester
      ? {
          _id: populatedCourse.semester._id,
          name: populatedCourse.semester.name,
          startDate: populatedCourse.semester.startDate,
          endDate: populatedCourse.semester.endDate,
        }
      : null,

    // Course content
    learningOutcomes: populatedCourse.outcomes?.outcomes || [],
    weeklyPlan:
      populatedCourse.weeklyPlan?.weeks?.map((week) => ({
        weekNumber: week.weekNumber,
        topics: week.topics,
      })) || [],
    creditPoints: populatedCourse.creditPoints
      ? {
          lecture: populatedCourse.creditPoints.lecture,
          tutorial: populatedCourse.creditPoints.tutorial,
          practical: populatedCourse.creditPoints.practical,
          project: populatedCourse.creditPoints.project,
        }
      : null,
    courseSchedule: populatedCourse.schedule
      ? {
          classStartDate: populatedCourse.schedule.classStartDate,
          classEndDate: populatedCourse.schedule.classEndDate,
          midSemesterExamDate: populatedCourse.schedule.midSemesterExamDate,
          endSemesterExamDate: populatedCourse.schedule.endSemesterExamDate,
          classDaysAndTimes: populatedCourse.schedule.classDaysAndTimes || [],
        }
      : null,

    // Statistics
    statistics: {
      lectureCount,
      assignmentCount,
      announcementCount,
      enrolledStudentsCount,
    },

    // Timestamps
    createdAt: populatedCourse.createdAt,
    updatedAt: populatedCourse.updatedAt,
  };
};

// Admin Create Course
exports.createCourse = catchAsyncErrors(async (req, res, next) => {
  logger.info("Admin createCourse: Started");

  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    logger.info("Transaction started");

    const {
      courseCode,
      title,
      aboutCourse,
      teacherEmail,
      semester,
      learningOutcomes,
      courseSchedule,
      weeklyPlan,
      creditPoints,
      attendance,
    } = req.body;

    // Validate required fields
    if (!courseCode) {
      logger.error("Course code is required");
      return next(new ErrorHandler("Course code is required", 400));
    }

    if (!title || !aboutCourse || !teacherEmail) {
      logger.error("Missing required fields: title, aboutCourse, teacherEmail");
      return next(
        new ErrorHandler(
          "Title, aboutCourse, and teacherEmail are required",
          400
        )
      );
    }

    const normalizedCourseCode = courseCode.toUpperCase().trim();
    const normalizedTeacherEmail = teacherEmail.toLowerCase().trim();

    logger.info(
      `Creating course with code: ${normalizedCourseCode} for teacher: ${normalizedTeacherEmail}`
    );

    // Check if course code already exists
    const existingCourse = await Course.findOne({
      courseCode: normalizedCourseCode,
    }).session(session);

    if (existingCourse) {
      logger.error(`Course code already exists: ${normalizedCourseCode}`);
      return next(
        new ErrorHandler(
          `Course with code ${normalizedCourseCode} already exists`,
          400
        )
      );
    }

    // Find teacher by email
    const teacher = await Teacher.findOne({
      email: normalizedTeacherEmail,
    })
      .populate("user", "name email mobileNo gender ageAsOn2025")
      .session(session);

    if (!teacher) {
      logger.error(`Teacher not found with email: ${normalizedTeacherEmail}`);
      return next(
        new ErrorHandler(
          `Teacher not found with email: ${normalizedTeacherEmail}`,
          404
        )
      );
    }

    // Add course code to teacher's course codes if not already present
    if (!teacher.courseCodes.includes(normalizedCourseCode)) {
      teacher.courseCodes.push(normalizedCourseCode);
      await teacher.save({ session });
      logger.info(
        `Added course code ${normalizedCourseCode} to teacher ${teacher.email}`
      );
    }

    // Create main course
    const courseData = {
      title: title.trim(),
      aboutCourse: aboutCourse.trim(),
      courseCode: normalizedCourseCode,
      semester: semester,
      teacher: teacher._id,
      isActive: true,
    };

    const course = new Course(courseData);
    await course.save({ session });
    logger.info(`Course created with ID: ${course._id}`);

    // Create learning outcomes if provided
    if (learningOutcomes && learningOutcomes.length > 0) {
      logger.info("Creating learning outcomes");
      const outcome = await CourseOutcome.create(
        [
          {
            outcomes: learningOutcomes,
            course: course._id,
          },
        ],
        { session }
      );
      course.outcomes = outcome[0]._id;
      logger.info(`Learning outcomes created with ID: ${outcome[0]._id}`);
    }

    // Create course schedule if provided
    if (courseSchedule) {
      logger.info("Creating course schedule");
      const schedule = await CourseSchedule.create(
        [
          {
            ...courseSchedule,
            course: course._id,
          },
        ],
        { session }
      );
      course.schedule = schedule[0]._id;
      logger.info(`Course schedule created with ID: ${schedule[0]._id}`);
    }

    // Create weekly plan if provided
    if (weeklyPlan && weeklyPlan.length > 0) {
      logger.info("Creating weekly plan");
      const weeklyPlanDoc = await WeeklyPlan.create(
        [
          {
            weeks: weeklyPlan,
            course: course._id,
          },
        ],
        { session }
      );
      course.weeklyPlan = weeklyPlanDoc[0]._id;
      logger.info(`Weekly plan created with ID: ${weeklyPlanDoc[0]._id}`);
    }

    // Create credit points if provided
    if (creditPoints) {
      logger.info("Creating credit points");
      const creditPointsDoc = await CreditPoints.create(
        [
          {
            ...creditPoints,
            course: course._id,
          },
        ],
        { session }
      );
      course.creditPoints = creditPointsDoc[0]._id;
      logger.info(`Credit points created with ID: ${creditPointsDoc[0]._id}`);
    }

    // Create attendance if provided
    if (attendance && attendance.sessions) {
      logger.info("Creating course attendance");
      const sessionsMap = new Map(Object.entries(attendance.sessions));
      const attendanceDoc = await CourseAttendance.create(
        [
          {
            sessions: sessionsMap,
            course: course._id,
          },
        ],
        { session }
      );
      course.attendance = attendanceDoc[0]._id;
      logger.info(`Course attendance created with ID: ${attendanceDoc[0]._id}`);
    }

    // Create basic syllabus structure
    const syllabus = await CourseSyllabus.create(
      [
        {
          modules: [],
          course: course._id,
        },
      ],
      { session }
    );
    course.syllabus = syllabus[0]._id;
    logger.info(`Course syllabus created with ID: ${syllabus[0]._id}`);

    // Save updated course with all references
    await course.save({ session });

    // Add course to teacher's courses array
    teacher.courses.push(course._id);
    await teacher.save({ session });

    // Add course to matching students
    const matchingStudents = await Student.find({
      teacher: teacher._id,
      courseCodes: normalizedCourseCode,
    }).session(session);

    if (matchingStudents.length > 0) {
      logger.info(
        `Adding course to ${matchingStudents.length} matching students`
      );
      const updatePromises = matchingStudents.map((student) => {
        if (!student.courses.includes(course._id)) {
          student.courses.push(course._id);
          return student.save({ session });
        }
        return Promise.resolve();
      });
      await Promise.all(updatePromises);
    }

    await session.commitTransaction();
    transactionStarted = false;
    logger.info("Transaction committed successfully");

    // Format and return response
    const formattedCourse = await formatCourseResponse(course);

    res.status(201).json({
      success: true,
      message: `Course with code ${normalizedCourseCode} created successfully`,
      course: formattedCourse,
    });
  } catch (error) {
    logger.error("Error in admin createCourse:", error);

    if (transactionStarted) {
      try {
        await session.abortTransaction();
        logger.info("Transaction aborted");
      } catch (abortError) {
        logger.error("Error aborting transaction:", abortError);
      }
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    await session.endSession();
    logger.info("Session ended");
  }
});

// Admin Update Course
exports.updateCourse = catchAsyncErrors(async (req, res, next) => {
  logger.info("Admin updateCourse: Started");

  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    logger.info("Transaction started");

    const {
      courseCode,
      newCourseCode,
      title,
      aboutCourse,
      teacherEmail,
      semester,
      learningOutcomes,
      courseSchedule,
      weeklyPlan,
      creditPoints,
      attendance,
      isActive,
    } = req.body;

    // Validate required courseCode
    if (!courseCode) {
      logger.error("Course code is required for update");
      return next(new ErrorHandler("Course code is required", 400));
    }

    const normalizedCourseCode = courseCode.toUpperCase().trim();
    logger.info(`Updating course with code: ${normalizedCourseCode}`);

    // Find existing course by courseCode
    const course = await Course.findOne({
      courseCode: normalizedCourseCode,
    }).session(session);

    if (!course) {
      logger.error(`Course not found with code: ${normalizedCourseCode}`);
      return next(
        new ErrorHandler(
          `Course with code ${normalizedCourseCode} not found`,
          404
        )
      );
    }

    let currentTeacher = await Teacher.findById(course.teacher)
      .populate("user", "name email mobileNo gender ageAsOn2025")
      .session(session);

    // Handle teacher change if teacherEmail is provided
    if (teacherEmail) {
      const normalizedTeacherEmail = teacherEmail.toLowerCase().trim();

      if (normalizedTeacherEmail !== currentTeacher.email) {
        logger.info(
          `Changing teacher from ${currentTeacher.email} to ${normalizedTeacherEmail}`
        );

        // Find new teacher
        const newTeacher = await Teacher.findOne({
          email: normalizedTeacherEmail,
        })
          .populate("user", "name email mobileNo gender ageAsOn2025")
          .session(session);

        if (!newTeacher) {
          logger.error(
            `New teacher not found with email: ${normalizedTeacherEmail}`
          );
          return next(
            new ErrorHandler(
              `Teacher not found with email: ${normalizedTeacherEmail}`,
              404
            )
          );
        }

        // Remove course code from old teacher if they don't have other courses with this code
        const oldTeacherOtherCourses = await Course.countDocuments({
          teacher: currentTeacher._id,
          courseCode: normalizedCourseCode,
          _id: { $ne: course._id },
        }).session(session);

        if (oldTeacherOtherCourses === 0) {
          currentTeacher.courseCodes = currentTeacher.courseCodes.filter(
            (code) => code !== normalizedCourseCode
          );
          currentTeacher.courses = currentTeacher.courses.filter(
            (id) => !id.equals(course._id)
          );
          await currentTeacher.save({ session });
        }

        // Add course code to new teacher if not present
        if (!newTeacher.courseCodes.includes(normalizedCourseCode)) {
          newTeacher.courseCodes.push(normalizedCourseCode);
        }
        if (!newTeacher.courses.includes(course._id)) {
          newTeacher.courses.push(course._id);
        }
        await newTeacher.save({ session });

        // Update course teacher
        course.teacher = newTeacher._id;
        currentTeacher = newTeacher;
        logger.info(`Teacher changed successfully`);
      }
    }

    // Handle course code change
    if (
      newCourseCode &&
      newCourseCode.toUpperCase().trim() !== normalizedCourseCode
    ) {
      const normalizedNewCourseCode = newCourseCode.toUpperCase().trim();

      // Check if new course code already exists
      const existingCourseWithNewCode = await Course.findOne({
        courseCode: normalizedNewCourseCode,
        _id: { $ne: course._id },
      }).session(session);

      if (existingCourseWithNewCode) {
        logger.error(
          `New course code already exists: ${normalizedNewCourseCode}`
        );
        return next(
          new ErrorHandler(
            `Course with code ${normalizedNewCourseCode} already exists`,
            400
          )
        );
      }

      logger.info(
        `Changing course code from ${normalizedCourseCode} to ${normalizedNewCourseCode}`
      );

      // Update course code
      course.courseCode = normalizedNewCourseCode;

      // Update teacher's course codes
      const oldCodeIndex =
        currentTeacher.courseCodes.indexOf(normalizedCourseCode);
      if (oldCodeIndex !== -1) {
        currentTeacher.courseCodes[oldCodeIndex] = normalizedNewCourseCode;
        await currentTeacher.save({ session });
      }

      // Update students' course codes
      await Student.updateMany(
        {
          teacher: currentTeacher._id,
          courseCodes: normalizedCourseCode,
          courses: course._id,
        },
        {
          $set: { "courseCodes.$": normalizedNewCourseCode },
        },
        { session }
      );

      logger.info(`Course code updated to ${normalizedNewCourseCode}`);
    }

    // Update basic course fields
    if (title) course.title = title.trim();
    if (aboutCourse) course.aboutCourse = aboutCourse.trim();
    if (semester) course.semester = semester;
    if (isActive !== undefined) course.isActive = isActive;

    // Update learning outcomes
    if (learningOutcomes) {
      if (course.outcomes) {
        await CourseOutcome.findByIdAndUpdate(
          course.outcomes,
          { outcomes: learningOutcomes },
          { session }
        );
        logger.info(`Updated existing learning outcomes`);
      } else {
        const outcome = await CourseOutcome.create(
          [
            {
              outcomes: learningOutcomes,
              course: course._id,
            },
          ],
          { session }
        );
        course.outcomes = outcome[0]._id;
        logger.info(`Created new learning outcomes`);
      }
    }

    // Update course schedule
    if (courseSchedule) {
      if (course.schedule) {
        await CourseSchedule.findByIdAndUpdate(
          course.schedule,
          courseSchedule,
          { session }
        );
        logger.info(`Updated existing schedule`);
      } else {
        const schedule = await CourseSchedule.create(
          [
            {
              ...courseSchedule,
              course: course._id,
            },
          ],
          { session }
        );
        course.schedule = schedule[0]._id;
        logger.info(`Created new schedule`);
      }
    }

    // Update weekly plan
    if (weeklyPlan) {
      if (course.weeklyPlan) {
        await WeeklyPlan.findByIdAndUpdate(
          course.weeklyPlan,
          { weeks: weeklyPlan },
          { session }
        );
        logger.info(`Updated existing weekly plan`);
      } else {
        const weeklyPlanDoc = await WeeklyPlan.create(
          [
            {
              weeks: weeklyPlan,
              course: course._id,
            },
          ],
          { session }
        );
        course.weeklyPlan = weeklyPlanDoc[0]._id;
        logger.info(`Created new weekly plan`);
      }
    }

    // Update credit points
    if (creditPoints) {
      if (course.creditPoints) {
        await CreditPoints.findByIdAndUpdate(
          course.creditPoints,
          creditPoints,
          { session }
        );
        logger.info(`Updated existing credit points`);
      } else {
        const creditPointsDoc = await CreditPoints.create(
          [
            {
              ...creditPoints,
              course: course._id,
            },
          ],
          { session }
        );
        course.creditPoints = creditPointsDoc[0]._id;
        logger.info(`Created new credit points`);
      }
    }

    // Update attendance
    if (attendance && attendance.sessions) {
      const sessionsMap = new Map(Object.entries(attendance.sessions));

      if (course.attendance) {
        await CourseAttendance.findByIdAndUpdate(
          course.attendance,
          { sessions: sessionsMap },
          { session }
        );
        logger.info(`Updated existing attendance`);
      } else {
        const attendanceDoc = await CourseAttendance.create(
          [
            {
              sessions: sessionsMap,
              course: course._id,
            },
          ],
          { session }
        );
        course.attendance = attendanceDoc[0]._id;
        logger.info(`Created new attendance`);
      }
    }

    // Save updated course
    await course.save({ session });

    await session.commitTransaction();
    transactionStarted = false;
    logger.info("Transaction committed successfully");

    // Format and return response
    const formattedCourse = await formatCourseResponse(course);

    res.status(200).json({
      success: true,
      message: `Course with code ${course.courseCode} updated successfully`,
      course: formattedCourse,
    });
  } catch (error) {
    logger.error("Error in admin updateCourse:", error);

    if (transactionStarted) {
      try {
        await session.abortTransaction();
        logger.info("Transaction aborted");
      } catch (abortError) {
        logger.error("Error aborting transaction:", abortError);
      }
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    await session.endSession();
    logger.info("Session ended");
  }
});

// Admin Delete Course
exports.deleteCourse = catchAsyncErrors(async (req, res, next) => {
  logger.info("Admin deleteCourse: Started");

  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    logger.info("Transaction started");

    const { courseCode } = req.body;

    // Validate required courseCode
    if (!courseCode) {
      logger.error("Course code is required for deletion");
      return next(new ErrorHandler("Course code is required", 400));
    }

    const normalizedCourseCode = courseCode.toUpperCase().trim();
    logger.info(`Deleting course with code: ${normalizedCourseCode}`);

    // Find course by courseCode
    const course = await Course.findOne({
      courseCode: normalizedCourseCode,
    }).session(session);

    if (!course) {
      logger.error(`Course not found with code: ${normalizedCourseCode}`);
      return next(
        new ErrorHandler(
          `Course with code ${normalizedCourseCode} not found`,
          404
        )
      );
    }

    // Get teacher info before deletion
    const teacher = await Teacher.findById(course.teacher)
      .populate("user", "name email")
      .session(session);
    const courseInfo = {
      _id: course._id,
      title: course.title,
      courseCode: course.courseCode,
      teacherName: teacher?.user?.name || "Unknown",
      teacherEmail: teacher?.email || "Unknown",
    };

    logger.info(
      `Deleting course: ${course.title} (${course.courseCode}) taught by ${teacher?.email}`
    );

    // Delete all related documents and files

    // 1. Delete course outcomes
    if (course.outcomes) {
      await CourseOutcome.findByIdAndDelete(course.outcomes).session(session);
      logger.info(`Deleted course outcomes: ${course.outcomes}`);
    }

    // 2. Delete course schedule
    if (course.schedule) {
      await CourseSchedule.findByIdAndDelete(course.schedule).session(session);
      logger.info(`Deleted course schedule: ${course.schedule}`);
    }

    // 3. Delete syllabus and all associated files
    if (course.syllabus) {
      const syllabus = await CourseSyllabus.findById(course.syllabus).session(
        session
      );
      if (syllabus) {
        const filesToDelete = [];

        // Collect all file keys from syllabus modules
        syllabus.modules.forEach((module) => {
          if (module.videos) {
            module.videos.forEach((video) => {
              if (video.fileKey) filesToDelete.push(video.fileKey);
              if (video.thumbnail?.thumbnailKey)
                filesToDelete.push(video.thumbnail.thumbnailKey);
            });
          }
          if (module.pdfs) {
            module.pdfs.forEach((pdf) => {
              if (pdf.fileKey) filesToDelete.push(pdf.fileKey);
              if (pdf.thumbnail?.thumbnailKey)
                filesToDelete.push(pdf.thumbnail.thumbnailKey);
            });
          }
          if (module.ppts) {
            module.ppts.forEach((ppt) => {
              if (ppt.fileKey) filesToDelete.push(ppt.fileKey);
              if (ppt.thumbnail?.thumbnailKey)
                filesToDelete.push(ppt.thumbnail.thumbnailKey);
            });
          }
          if (module.links) {
            module.links.forEach((link) => {
              if (link.thumbnail?.thumbnailKey)
                filesToDelete.push(link.thumbnail.thumbnailKey);
            });
          }
        });

        // Delete files from Azure
        if (filesToDelete.length > 0) {
          logger.info(
            `Deleting ${filesToDelete.length} syllabus files from Azure`
          );
          const deletePromises = filesToDelete.map(async (fileKey) => {
            try {
              await deleteFileFromAzure(fileKey);
            } catch (azureError) {
              logger.error(`Error deleting file ${fileKey}:`, azureError);
            }
          });
          await Promise.allSettled(deletePromises);
        }
      }

      await CourseSyllabus.findByIdAndDelete(course.syllabus).session(session);
      logger.info(`Deleted course syllabus: ${course.syllabus}`);
    }

    // 4. Delete weekly plan
    if (course.weeklyPlan) {
      await WeeklyPlan.findByIdAndDelete(course.weeklyPlan).session(session);
      logger.info(`Deleted weekly plan: ${course.weeklyPlan}`);
    }

    // 5. Delete credit points
    if (course.creditPoints) {
      await CreditPoints.findByIdAndDelete(course.creditPoints).session(
        session
      );
      logger.info(`Deleted credit points: ${course.creditPoints}`);
    }

    // 6. Delete course attendance
    if (course.attendance) {
      await CourseAttendance.findByIdAndDelete(course.attendance).session(
        session
      );
      logger.info(`Deleted course attendance: ${course.attendance}`);
    }

    // 7. Delete all lectures and their video files
    const lectures = await Lecture.find({ course: course._id }).session(
      session
    );
    if (lectures.length > 0) {
      logger.info(`Deleting ${lectures.length} lectures`);
      for (const lecture of lectures) {
        if (lecture.videoKey) {
          try {
            await deleteFileFromAzure(lecture.videoKey);
            logger.info(`Deleted lecture video: ${lecture.videoKey}`);
          } catch (deleteError) {
            logger.error("Error deleting lecture video:", deleteError);
          }
        }
      }
      await Lecture.deleteMany({ course: course._id }).session(session);
    }

    // 8. Delete all assignments and their files
    const assignments = await Assignment.find({ course: course._id }).session(
      session
    );
    if (assignments.length > 0) {
      logger.info(`Deleting ${assignments.length} assignments`);
      for (const assignment of assignments) {
        // Delete attachment files
        if (assignment.attachments?.length > 0) {
          for (const attachment of assignment.attachments) {
            try {
              await deleteFileFromAzure(attachment.key);
            } catch (deleteError) {
              logger.error(
                "Error deleting assignment attachment:",
                deleteError
              );
            }
          }
        }
        // Delete submission files
        if (assignment.submissions?.length > 0) {
          for (const submission of assignment.submissions) {
            if (submission.submissionFileKey) {
              try {
                await deleteFileFromAzure(submission.submissionFileKey);
              } catch (deleteError) {
                logger.error("Error deleting submission file:", deleteError);
              }
            }
          }
        }
      }
      await Assignment.deleteMany({ course: course._id }).session(session);
    }

    // 9. Delete all announcements and their images
    const announcements = await Announcement.find({
      course: course._id,
    }).session(session);
    if (announcements.length > 0) {
      logger.info(`Deleting ${announcements.length} announcements`);
      for (const announcement of announcements) {
        if (announcement.image?.imageKey) {
          try {
            await deleteFileFromAzure(announcement.image.imageKey);
          } catch (deleteError) {
            logger.error("Error deleting announcement image:", deleteError);
          }
        }
      }
      await Announcement.deleteMany({ course: course._id }).session(session);
    }

    // 10. Delete all discussions
    const discussions = await Discussion.find({ course: course._id }).session(
      session
    );
    if (discussions.length > 0) {
      logger.info(`Deleting ${discussions.length} discussions`);
      for (const discussion of discussions) {
        // Delete discussion attachments
        if (discussion.attachments?.length > 0) {
          for (const attachment of discussion.attachments) {
            try {
              await deleteFileFromAzure(attachment.fileKey);
            } catch (deleteError) {
              logger.error(
                "Error deleting discussion attachment:",
                deleteError
              );
            }
          }
        }
        // Delete comment attachments
        if (discussion.comments?.length > 0) {
          for (const comment of discussion.comments) {
            if (comment.attachments?.length > 0) {
              for (const attachment of comment.attachments) {
                try {
                  await deleteFileFromAzure(attachment.fileKey);
                } catch (deleteError) {
                  logger.error(
                    "Error deleting comment attachment:",
                    deleteError
                  );
                }
              }
            }
          }
        }
      }
      await Discussion.deleteMany({ course: course._id }).session(session);
    }

    // 11. Delete EContent
    const eContent = await EContent.findOne({ course: course._id }).session(
      session
    );
    if (eContent) {
      logger.info("Deleting EContent");
      for (const module of eContent.modules) {
        if (module.files?.length > 0) {
          for (const file of module.files) {
            try {
              await deleteFileFromAzure(file.fileKey);
            } catch (deleteError) {
              logger.error("Error deleting EContent file:", deleteError);
            }
          }
        }
      }
      await EContent.deleteMany({ course: course._id }).session(session);
    }

    // 12. Update teacher - remove course and course code if no other courses use it
    if (teacher) {
      // Remove course from teacher's courses array
      teacher.courses = teacher.courses.filter((id) => !id.equals(course._id));

      // Check if teacher has other courses with this course code
      const otherCoursesWithSameCode = await Course.countDocuments({
        teacher: teacher._id,
        courseCode: normalizedCourseCode,
        _id: { $ne: course._id },
      }).session(session);

      // Remove course code only if no other courses use it
      if (otherCoursesWithSameCode === 0) {
        teacher.courseCodes = teacher.courseCodes.filter(
          (code) => code !== normalizedCourseCode
        );
        logger.info(
          `Removed course code ${normalizedCourseCode} from teacher ${teacher.email}`
        );
      }

      await teacher.save({ session });
      logger.info(`Updated teacher ${teacher.email}`);
    }

    // 13. Remove course from all students
    const studentsWithCourse = await Student.find({
      courses: course._id,
    }).session(session);

    if (studentsWithCourse.length > 0) {
      logger.info(`Removing course from ${studentsWithCourse.length} students`);
      const updatePromises = studentsWithCourse.map((student) => {
        student.courses = student.courses.filter(
          (id) => !id.equals(course._id)
        );
        return student.save({ session });
      });
      await Promise.all(updatePromises);
    }

    // 14. Finally, delete the course itself
    await Course.findByIdAndDelete(course._id).session(session);
    logger.info(`Deleted course: ${course._id}`);

    await session.commitTransaction();
    transactionStarted = false;
    logger.info("Transaction committed successfully");

    res.status(200).json({
      success: true,
      message: `Course with code ${normalizedCourseCode} deleted successfully`,
      deletedCourse: courseInfo,
      statistics: {
        lecturesDeleted: lectures.length,
        assignmentsDeleted: assignments.length,
        announcementsDeleted: announcements.length,
        discussionsDeleted: discussions.length,
        studentsAffected: studentsWithCourse.length,
      },
    });
  } catch (error) {
    logger.error("Error in admin deleteCourse:", error);

    if (transactionStarted) {
      try {
        await session.abortTransaction();
        logger.info("Transaction aborted");
      } catch (abortError) {
        logger.error("Error aborting transaction:", abortError);
      }
    }

    return next(new ErrorHandler(error.message, 500));
  } finally {
    await session.endSession();
    logger.info("Session ended");
  }
});

// Get course by courseCode (Admin helper method)
exports.getCourseByCode = catchAsyncErrors(async (req, res, next) => {
  logger.info("Admin getCourseByCode: Started");

  try {
    const { courseCode } = req.params;

    if (!courseCode) {
      logger.error("Course code is required");
      return next(new ErrorHandler("Course code is required", 400));
    }

    const normalizedCourseCode = courseCode.toUpperCase().trim();
    logger.info(`Fetching course with code: ${normalizedCourseCode}`);

    // Find course by courseCode
    const course = await Course.findOne({
      courseCode: normalizedCourseCode,
    });

    if (!course) {
      logger.error(`Course not found with code: ${normalizedCourseCode}`);
      return next(
        new ErrorHandler(
          `Course with code ${normalizedCourseCode} not found`,
          404
        )
      );
    }

    // Format and return response
    const formattedCourse = await formatCourseResponse(course);

    res.status(200).json({
      success: true,
      message: `Course with code ${normalizedCourseCode} retrieved successfully`,
      course: formattedCourse,
    });
  } catch (error) {
    logger.error("Error in admin getCourseByCode:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

// Get all courses (Admin method)
exports.getAllCourses = catchAsyncErrors(async (req, res, next) => {
  logger.info("Admin getAllCourses: Started");

  try {
    const {
      page = 1,
      limit = 10,
      courseCode,
      teacherEmail,
      isActive,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    let query = {};

    if (courseCode) {
      query.courseCode = { $regex: courseCode.toUpperCase(), $options: "i" };
    }

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    // Handle teacher email filter
    if (teacherEmail) {
      const teachers = await Teacher.find({
        email: { $regex: teacherEmail, $options: "i" },
      });
      const teacherIds = teachers.map((t) => t._id);
      if (teacherIds.length > 0) {
        query.teacher = { $in: teacherIds };
      } else {
        // No teachers found with that email
        return res.status(200).json({
          success: true,
          message: "No courses found",
          pagination: {
            currentPage: pageNum,
            totalPages: 0,
            totalCourses: 0,
            hasNext: false,
            hasPrev: false,
          },
          courses: [],
        });
      }
    }

    // Get total count
    const totalCourses = await Course.countDocuments(query);

    // Get courses with pagination
    const courses = await Course.find(query)
      .populate({
        path: "teacher",
        populate: {
          path: "user",
          select: "name email mobileNo gender ageAsOn2025",
        },
      })
      .populate("semester", "name startDate endDate")
      .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
      .skip(skip)
      .limit(limitNum);

    // Format all courses
    const formattedCourses = await Promise.all(
      courses.map((course) => formatCourseResponse(course))
    );

    res.status(200).json({
      success: true,
      message: "Courses retrieved successfully",
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCourses / limitNum),
        totalCourses,
        hasNext: pageNum < Math.ceil(totalCourses / limitNum),
        hasPrev: pageNum > 1,
      },
      courses: formattedCourses,
    });
  } catch (error) {
    logger.error("Error in admin getAllCourses:", error);
    return next(new ErrorHandler(error.message, 500));
  }
});

module.exports = exports;
