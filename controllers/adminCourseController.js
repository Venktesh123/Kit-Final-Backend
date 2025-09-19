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

// Helper function to find teacher by course code
const findTeacherByCourseCode = async (courseCode, session = null) => {
  logger.info(`Looking for teacher with course code: ${courseCode}`);

  const teacher = await Teacher.findOne({
    courseCodes: courseCode.toUpperCase().trim(),
  })
    .populate({
      path: "user",
      select: "name email mobileNo gender ageAsOn2025",
    })
    .session(session);

  if (!teacher) {
    throw new ErrorHandler(
      `No teacher found with course code: ${courseCode}. This course code is not assigned to any teacher.`,
      404
    );
  }

  logger.info(
    `Found teacher: ${teacher.user?.name} (${teacher.email}) for course code: ${courseCode}`
  );
  return teacher;
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

    if (!title || !aboutCourse) {
      logger.error("Missing required fields: title, aboutCourse");
      return next(new ErrorHandler("Title and aboutCourse are required", 400));
    }

    const normalizedCourseCode = courseCode.toUpperCase().trim();
    logger.info(`Creating course with code: ${normalizedCourseCode}`);

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

    // Find teacher by course code (instead of email)
    const teacher = await findTeacherByCourseCode(
      normalizedCourseCode,
      session
    );

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

    return next(new ErrorHandler(error.message, error.statusCode || 500));
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
      .populate({
        path: "user",
        select: "name email mobileNo gender ageAsOn2025",
      })
      .session(session);

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

      // Find teacher for new course code
      const newTeacher = await findTeacherByCourseCode(
        normalizedNewCourseCode,
        session
      );

      // If different teacher, update teacher assignments
      if (!currentTeacher._id.equals(newTeacher._id)) {
        logger.info(
          `Changing teacher from ${currentTeacher.email} to ${newTeacher.email}`
        );

        // Remove course from old teacher
        currentTeacher.courses = currentTeacher.courses.filter(
          (id) => !id.equals(course._id)
        );
        await currentTeacher.save({ session });

        // Add course to new teacher
        if (!newTeacher.courses.includes(course._id)) {
          newTeacher.courses.push(course._id);
        }
        await newTeacher.save({ session });

        // Update course teacher
        course.teacher = newTeacher._id;
        currentTeacher = newTeacher;
      }

      // Update course code
      course.courseCode = normalizedNewCourseCode;

      // Update student enrollments
      const studentsWithOldCode = await Student.find({
        teacher: currentTeacher._id,
        courseCodes: normalizedCourseCode,
        courses: course._id,
      }).session(session);

      for (const student of studentsWithOldCode) {
        // Remove old course code and add new one
        student.courseCodes = student.courseCodes.filter(
          (code) => code !== normalizedCourseCode
        );
        if (!student.courseCodes.includes(normalizedNewCourseCode)) {
          student.courseCodes.push(normalizedNewCourseCode);
        }
        await student.save({ session });
      }

      // Add course to students with new course code who don't already have it
      const studentsWithNewCode = await Student.find({
        teacher: currentTeacher._id,
        courseCodes: normalizedNewCourseCode,
        courses: { $nin: [course._id] },
      }).session(session);

      for (const student of studentsWithNewCode) {
        student.courses.push(course._id);
        await student.save({ session });
      }

      logger.info(`Updated student enrollments for course code change`);
    } else if (
      newCourseCode &&
      newCourseCode.toUpperCase().trim() === normalizedCourseCode
    ) {
      // If newCourseCode is provided but same as current, validate teacher still has access
      await findTeacherByCourseCode(normalizedCourseCode, session);
    } else {
      // No course code change, validate current teacher still has access to current course code
      await findTeacherByCourseCode(normalizedCourseCode, session);
    }

    // Update other main course fields
    if (title) course.title = title.trim();
    if (aboutCourse) course.aboutCourse = aboutCourse.trim();
    if (semester) course.semester = semester;
    if (isActive !== undefined) course.isActive = isActive;

    await course.save({ session });
    logger.info("Updated main course fields");

    // Update learning outcomes
    if (learningOutcomes) {
      if (course.outcomes) {
        await CourseOutcome.findByIdAndUpdate(
          course.outcomes,
          { outcomes: learningOutcomes },
          { session }
        );
        logger.info(`Updated existing learning outcomes: ${course.outcomes}`);
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
        await course.save({ session });
        logger.info(`Created new learning outcomes: ${outcome[0]._id}`);
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
        logger.info(`Updated existing schedule: ${course.schedule}`);
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
        await course.save({ session });
        logger.info(`Created new schedule: ${schedule[0]._id}`);
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
        logger.info(`Updated existing weekly plan: ${course.weeklyPlan}`);
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
        await course.save({ session });
        logger.info(`Created new weekly plan: ${weeklyPlanDoc[0]._id}`);
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
        logger.info(`Updated existing credit points: ${course.creditPoints}`);
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
        await course.save({ session });
        logger.info(`Created new credit points: ${creditPointsDoc[0]._id}`);
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
        logger.info(`Updated existing attendance: ${course.attendance}`);
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
        await course.save({ session });
        logger.info(`Created new attendance: ${attendanceDoc[0]._id}`);
      }
    }

    logger.info("Committing transaction");
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

    return next(new ErrorHandler(error.message, error.statusCode || 500));
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

    // Delete all related documents and files (same as original implementation)
    if (course.outcomes) {
      await CourseOutcome.findByIdAndDelete(course.outcomes).session(session);
      logger.info(`Deleted course outcomes: ${course.outcomes}`);
    }

    if (course.schedule) {
      await CourseSchedule.findByIdAndDelete(course.schedule).session(session);
      logger.info(`Deleted course schedule: ${course.schedule}`);
    }

    if (course.syllabus) {
      // Delete syllabus content files from Azure
      const syllabus = await CourseSyllabus.findById(course.syllabus).session(
        session
      );
      if (syllabus) {
        const filesToDelete = [];

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
              logger.error("Error deleting file from Azure:", azureError);
            }
          });
          await Promise.allSettled(deletePromises);
        }
      }

      await CourseSyllabus.findByIdAndDelete(course.syllabus).session(session);
      logger.info(`Deleted course syllabus: ${course.syllabus}`);
    }

    if (course.weeklyPlan) {
      await WeeklyPlan.findByIdAndDelete(course.weeklyPlan).session(session);
      logger.info(`Deleted weekly plan: ${course.weeklyPlan}`);
    }

    if (course.creditPoints) {
      await CreditPoints.findByIdAndDelete(course.creditPoints).session(
        session
      );
      logger.info(`Deleted credit points: ${course.creditPoints}`);
    }

    if (course.attendance) {
      await CourseAttendance.findByIdAndDelete(course.attendance).session(
        session
      );
      logger.info(`Deleted course attendance: ${course.attendance}`);
    }

    // Delete all lectures for this course
    const lectures = await Lecture.find({ course: course._id }).session(
      session
    );
    for (const lecture of lectures) {
      if (lecture.videoKey) {
        try {
          await deleteFileFromAzure(lecture.videoKey);
          logger.info(`Deleted video from Azure: ${lecture.videoKey}`);
        } catch (deleteError) {
          logger.error("Error deleting video file:", deleteError);
        }
      }
    }
    await Lecture.deleteMany({ course: course._id }).session(session);

    // Delete assignments and their files
    const assignments = await Assignment.find({ course: course._id }).session(
      session
    );
    for (const assignment of assignments) {
      // Delete attachment files
      if (assignment.attachments?.length > 0) {
        for (const attachment of assignment.attachments) {
          try {
            await deleteFileFromAzure(attachment.key);
          } catch (deleteError) {
            logger.error("Error deleting assignment attachment:", deleteError);
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

    // Delete announcements and their images
    const announcements = await Announcement.find({
      course: course._id,
    }).session(session);
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

    // Delete discussions
    await Discussion.deleteMany({ course: course._id }).session(session);

    // Delete EContent
    const eContent = await EContent.findOne({ course: course._id }).session(
      session
    );
    if (eContent) {
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
    }
    await EContent.deleteMany({ course: course._id }).session(session);

    // Remove course from teacher's courses
    if (teacher) {
      teacher.courses = teacher.courses.filter((id) => !id.equals(course._id));
      await teacher.save({ session });
      logger.info(`Updated teacher ${teacher.email}`);
    }

    // Remove course from all students
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

    // Delete the course itself
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

    return next(new ErrorHandler(error.message, error.statusCode || 500));
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
    return next(new ErrorHandler(error.message, error.statusCode || 500));
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
    return next(new ErrorHandler(error.message, error.statusCode || 500));
  }
});

// Get courses by specific course code with teacher info
exports.getCoursesByCode = catchAsyncErrors(async (req, res, next) => {
  logger.info("Admin getCoursesByCode: Started");

  try {
    const { courseCode } = req.params;
    logger.info(`Fetching courses for course code: ${courseCode}`);

    if (!courseCode) {
      return next(new ErrorHandler("Course code is required", 400));
    }

    const normalizedCourseCode = courseCode.toUpperCase().trim();

    // First, check if any teacher has this course code
    const teacher = await Teacher.findOne({
      courseCodes: normalizedCourseCode,
    }).populate({
      path: "user",
      select: "name email mobileNo gender ageAsOn2025",
    });

    if (!teacher) {
      return res.status(200).json({
        success: true,
        message: `Course code ${normalizedCourseCode} is not assigned to any teacher`,
        courseCode: normalizedCourseCode,
        teacher: null,
        courses: [],
        isValidCourseCode: false,
      });
    }

    // Find all courses with this course code
    const courses = await Course.find({ courseCode: normalizedCourseCode })
      .populate("semester", "name startDate endDate")
      .sort({ createdAt: -1 });

    // Format courses with statistics
    const coursesWithStats = await Promise.all(
      courses.map((course) => formatCourseResponse(course))
    );

    res.status(200).json({
      success: true,
      message: `Found ${courses.length} courses for course code: ${normalizedCourseCode}`,
      courseCode: normalizedCourseCode,
      teacher: {
        _id: teacher._id,
        name: teacher.user?.name || "Unknown",
        email: teacher.email,
        mobileNo: teacher.user?.mobileNo || "",
        gender: teacher.user?.gender || "",
        age: teacher.user?.ageAsOn2025 || null,
        courseCodes: teacher.courseCodes,
      },
      totalCourses: courses.length,
      courses: coursesWithStats,
      isValidCourseCode: true,
    });
  } catch (error) {
    logger.error("Error in admin getCoursesByCode:", error);
    return next(new ErrorHandler(error.message, error.statusCode || 500));
  }
});

// Bulk operations for admin
exports.bulkCreateCourses = catchAsyncErrors(async (req, res, next) => {
  logger.info("Admin bulkCreateCourses: Started");

  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    logger.info("Transaction started");

    const { courses } = req.body;

    if (!courses || !Array.isArray(courses) || courses.length === 0) {
      return next(new ErrorHandler("Courses array is required", 400));
    }

    const results = [];
    const errors = [];

    for (const courseData of courses) {
      try {
        const {
          courseCode,
          title,
          aboutCourse,
          semester,
          learningOutcomes,
          courseSchedule,
          weeklyPlan,
          creditPoints,
        } = courseData;

        if (!courseCode || !title || !aboutCourse) {
          errors.push({
            courseCode: courseCode || "UNKNOWN",
            error: "Missing required fields: courseCode, title, or aboutCourse",
          });
          continue;
        }

        const normalizedCourseCode = courseCode.toUpperCase().trim();

        // Check if course already exists
        const existingCourse = await Course.findOne({
          courseCode: normalizedCourseCode,
        }).session(session);

        if (existingCourse) {
          errors.push({
            courseCode: normalizedCourseCode,
            error: "Course with this code already exists",
          });
          continue;
        }

        // Find teacher by course code
        const teacher = await findTeacherByCourseCode(
          normalizedCourseCode,
          session
        );

        // Create course
        const course = new Course({
          title: title.trim(),
          aboutCourse: aboutCourse.trim(),
          courseCode: normalizedCourseCode,
          semester: semester,
          teacher: teacher._id,
          isActive: true,
        });

        await course.save({ session });

        // Create basic syllabus
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
        await course.save({ session });

        // Add to teacher's courses
        if (!teacher.courses.includes(course._id)) {
          teacher.courses.push(course._id);
          await teacher.save({ session });
        }

        // Add to matching students
        const matchingStudents = await Student.find({
          teacher: teacher._id,
          courseCodes: normalizedCourseCode,
        }).session(session);

        for (const student of matchingStudents) {
          if (!student.courses.includes(course._id)) {
            student.courses.push(course._id);
            await student.save({ session });
          }
        }

        results.push({
          courseCode: normalizedCourseCode,
          courseId: course._id,
          teacherEmail: teacher.email,
          enrolledStudents: matchingStudents.length,
          success: true,
        });
      } catch (courseError) {
        logger.error(
          `Error creating course ${courseData.courseCode}:`,
          courseError
        );
        errors.push({
          courseCode: courseData.courseCode || "UNKNOWN",
          error: courseError.message,
        });
      }
    }

    await session.commitTransaction();
    transactionStarted = false;
    logger.info("Bulk creation transaction committed successfully");

    res.status(200).json({
      success: true,
      message: `Bulk course creation completed. ${results.length} courses created, ${errors.length} errors`,
      summary: {
        totalRequested: courses.length,
        successful: results.length,
        failed: errors.length,
      },
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error("Error in admin bulkCreateCourses:", error);

    if (transactionStarted) {
      try {
        await session.abortTransaction();
        logger.info("Transaction aborted");
      } catch (abortError) {
        logger.error("Error aborting transaction:", abortError);
      }
    }

    return next(new ErrorHandler(error.message, error.statusCode || 500));
  } finally {
    await session.endSession();
    logger.info("Session ended");
  }
});
// Add this function to controllers/adminController.js

// Get all modules for a course with minimal information
// Enhanced getCourseModules function with comprehensive module information
exports.getAllCoursesgetCourseModules = catchAsyncErrors(
  async (req, res, next) => {
    console.log("getCourseModules: Started");

    try {
      const { courseId } = req.params;
      const { includeContent = "true", sortBy = "order" } = req.query;

      console.log(`Fetching modules for course: ${courseId}`);

      if (!courseId) {
        return next(new ErrorHandler("Course ID is required", 400));
      }

      // Verify course exists and get course details
      const course = await Course.findById(courseId)
        .populate("teacher", "email")
        .populate("semester", "name startDate endDate");

      if (!course) {
        return next(new ErrorHandler("Course not found", 404));
      }

      // Verify user access to course
      let userHasAccess = false;
      let userRole = req.user.role;

      if (userRole === "teacher") {
        const teacher = await Teacher.findOne({ user: req.user.id });
        if (teacher && course.teacher._id.equals(teacher._id)) {
          userHasAccess = true;
        }
      } else if (userRole === "student") {
        const student = await Student.findOne({ user: req.user.id });
        if (student && student.courses.includes(courseId)) {
          userHasAccess = true;
        }
      } else if (userRole === "admin") {
        userHasAccess = true;
      }

      if (!userHasAccess) {
        return next(new ErrorHandler("Access denied to this course", 403));
      }

      // Find the course syllabus with populated lectures
      const syllabus = await CourseSyllabus.findOne({
        course: courseId,
      }).populate({
        path: "modules.lectures",
        model: "Lecture",
        select:
          "title content videoUrl videoKey moduleNumber lectureOrder isReviewed reviewDeadline createdAt updatedAt",
      });

      if (!syllabus) {
        return res.status(200).json({
          success: true,
          message: "No modules found for this course",
          courseInfo: {
            _id: course._id,
            title: course.title,
            courseCode: course.courseCode,
            teacher: course.teacher,
            semester: course.semester,
          },
          modules: [],
          summary: {
            moduleCount: 0,
            totalContentItems: 0,
            contentBreakdown: {
              videos: 0,
              links: 0,
              pdfs: 0,
              ppts: 0,
              lectures: 0,
            },
          },
        });
      }

      // Format modules with comprehensive information
      const modules = syllabus.modules.map((module) => {
        // Count different content types
        const videoCount = module.videos ? module.videos.length : 0;
        const linkCount = module.links ? module.links.length : 0;
        const pdfCount = module.pdfs ? module.pdfs.length : 0;
        const pptCount = module.ppts ? module.ppts.length : 0;
        const lectureCount = module.lectures ? module.lectures.length : 0;
        const totalContentCount =
          videoCount + linkCount + pdfCount + pptCount + lectureCount;

        // Base module information
        const moduleInfo = {
          _id: module._id,
          moduleNumber: module.moduleNumber,
          moduleTitle: module.moduleTitle,
          description: module.description || "",
          isActive: module.isActive,
          order: module.order,
          createdAt: module.createdAt,
          updatedAt: module.updatedAt,

          // Content statistics
          contentCounts: {
            videos: videoCount,
            links: linkCount,
            pdfs: pdfCount,
            ppts: pptCount,
            lectures: lectureCount,
            total: totalContentCount,
          },
          hasContent: totalContentCount > 0,

          // Lecture statistics (if any)
          lectureStats:
            lectureCount > 0
              ? {
                  total: lectureCount,
                  reviewed: module.lectures
                    ? module.lectures.filter((l) => l.isReviewed).length
                    : 0,
                  pending: module.lectures
                    ? module.lectures.filter((l) => !l.isReviewed).length
                    : 0,
                  completion:
                    lectureCount > 0
                      ? Math.round(
                          (module.lectures.filter((l) => l.isReviewed).length /
                            lectureCount) *
                            100
                        )
                      : 0,
                }
              : null,
        };

        // Include full content details if requested
        if (includeContent === "true") {
          // Sort content by order
          moduleInfo.content = {
            videos: module.videos
              ? [...module.videos]
                  .sort((a, b) => (a.order || 0) - (b.order || 0))
                  .map((video) => ({
                    _id: video._id,
                    name: video.name,
                    description: video.description,
                    fileUrl: video.fileUrl,
                    fileName: video.fileName,
                    duration: video.duration,
                    videoSize: video.videoSize,
                    videoQuality: video.videoQuality,
                    thumbnail: video.thumbnail,
                    createDate: video.createDate,
                    isActive: video.isActive,
                    order: video.order,
                  }))
              : [],

            links: module.links
              ? [...module.links]
                  .sort((a, b) => (a.order || 0) - (b.order || 0))
                  .map((link) => ({
                    _id: link._id,
                    name: link.name,
                    description: link.description,
                    fileUrl: link.fileUrl,
                    linkType: link.linkType,
                    isExternal: link.isExternal,
                    thumbnail: link.thumbnail,
                    createDate: link.createDate,
                    isActive: link.isActive,
                    order: link.order,
                  }))
              : [],

            pdfs: module.pdfs
              ? [...module.pdfs]
                  .sort((a, b) => (a.order || 0) - (b.order || 0))
                  .map((pdf) => ({
                    _id: pdf._id,
                    name: pdf.name,
                    description: pdf.description,
                    fileUrl: pdf.fileUrl,
                    fileName: pdf.fileName,
                    fileSize: pdf.fileSize,
                    pageCount: pdf.pageCount,
                    thumbnail: pdf.thumbnail,
                    createDate: pdf.createDate,
                    isActive: pdf.isActive,
                    order: pdf.order,
                  }))
              : [],

            ppts: module.ppts
              ? [...module.ppts]
                  .sort((a, b) => (a.order || 0) - (b.order || 0))
                  .map((ppt) => ({
                    _id: ppt._id,
                    name: ppt.name,
                    description: ppt.description,
                    fileUrl: ppt.fileUrl,
                    fileName: ppt.fileName,
                    fileSize: ppt.fileSize,
                    slideCount: ppt.slideCount,
                    presentationType: ppt.presentationType,
                    thumbnail: ppt.thumbnail,
                    createDate: ppt.createDate,
                    isActive: ppt.isActive,
                    order: ppt.order,
                  }))
              : [],

            lectures: module.lectures
              ? [...module.lectures]
                  .sort((a, b) => (a.lectureOrder || 0) - (b.lectureOrder || 0))
                  .map((lecture) => ({
                    _id: lecture._id,
                    title: lecture.title,
                    content: lecture.content,
                    videoUrl:
                      userRole === "student"
                        ? lecture.isReviewed
                          ? lecture.videoUrl
                          : null
                        : lecture.videoUrl,
                    moduleNumber: lecture.moduleNumber,
                    lectureOrder: lecture.lectureOrder,
                    isReviewed: lecture.isReviewed,
                    reviewDeadline: lecture.reviewDeadline,
                    createdAt: lecture.createdAt,
                    updatedAt: lecture.updatedAt,
                    // Hide video URL from students if not reviewed
                    accessRestricted:
                      userRole === "student" && !lecture.isReviewed,
                  }))
              : [],
          };

          // Calculate content duration and size totals
          moduleInfo.contentSummary = {
            totalSize: [
              ...(module.videos || []),
              ...(module.pdfs || []),
              ...(module.ppts || []),
            ].reduce(
              (sum, item) => sum + (item.fileSize || item.videoSize || 0),
              0
            ),

            totalDuration: (module.videos || [])
              .filter((v) => v.duration)
              .reduce((total, video) => {
                // Convert duration string "MM:SS" to seconds
                const parts = video.duration.split(":");
                const minutes = parseInt(parts[0]) || 0;
                const seconds = parseInt(parts[1]) || 0;
                return total + minutes * 60 + seconds;
              }, 0),
          };
        }

        return moduleInfo;
      });

      // Sort modules based on query parameter
      const sortedModules = modules.sort((a, b) => {
        switch (sortBy) {
          case "moduleNumber":
            return a.moduleNumber - b.moduleNumber;
          case "title":
            return a.moduleTitle.localeCompare(b.moduleTitle);
          case "contentCount":
            return b.contentCounts.total - a.contentCounts.total;
          case "updated":
            return new Date(b.updatedAt) - new Date(a.updatedAt);
          case "order":
          default:
            return (a.order || a.moduleNumber) - (b.order || b.moduleNumber);
        }
      });

      // Calculate summary statistics
      const summary = {
        moduleCount: modules.length,
        activeModuleCount: modules.filter((m) => m.isActive).length,
        totalContentItems: modules.reduce(
          (sum, module) => sum + module.contentCounts.total,
          0
        ),
        contentBreakdown: {
          videos: modules.reduce(
            (sum, module) => sum + module.contentCounts.videos,
            0
          ),
          links: modules.reduce(
            (sum, module) => sum + module.contentCounts.links,
            0
          ),
          pdfs: modules.reduce(
            (sum, module) => sum + module.contentCounts.pdfs,
            0
          ),
          ppts: modules.reduce(
            (sum, module) => sum + module.contentCounts.ppts,
            0
          ),
          lectures: modules.reduce(
            (sum, module) => sum + module.contentCounts.lectures,
            0
          ),
        },
        overallProgress: {
          totalLectures: modules.reduce(
            (sum, module) => sum + module.contentCounts.lectures,
            0
          ),
          reviewedLectures: modules.reduce(
            (sum, module) =>
              sum + (module.lectureStats ? module.lectureStats.reviewed : 0),
            0
          ),
          completionPercentage: 0,
        },
      };

      // Calculate overall completion percentage
      if (summary.overallProgress.totalLectures > 0) {
        summary.overallProgress.completionPercentage = Math.round(
          (summary.overallProgress.reviewedLectures /
            summary.overallProgress.totalLectures) *
            100
        );
      }

      console.log(`Found ${modules.length} modules for course ${courseId}`);

      res.status(200).json({
        success: true,
        message: "Course modules retrieved successfully",
        courseInfo: {
          _id: course._id,
          title: course.title,
          courseCode: course.courseCode,
          teacher: {
            _id: course.teacher._id,
            email: course.teacher.email,
          },
          semester: course.semester,
        },
        modules: sortedModules,
        summary: summary,
        userRole: userRole,
        requestOptions: {
          includeContent: includeContent === "true",
          sortBy: sortBy,
        },
      });
    } catch (error) {
      console.error("Error in getCourseModules:", error);
      return next(new ErrorHandler(error.message, 500));
    }
  }
);
// Add this to the module.exports at the bottom of adminController.js

module.exports = exports;
