const Course = require("../models/Course");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const Lecture = require("../models/Lecture");
const CourseOutcome = require("../models/CourseOutcome");
const CourseSchedule = require("../models/CourseSchedule");
const CourseSyllabus = require("../models/CourseSyllabus");
const WeeklyPlan = require("../models/WeeklyPlan");
const CreditPoints = require("../models/CreditPoints");
const Assignment = require("../models/Assignment");
const CourseAttendance = require("../models/CourseAttendance");
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

// SHARED UTILITY: Get syllabus with populated lectures (simplified)
const getSyllabusWithLectures = async (courseId) => {
  const syllabus = await CourseSyllabus.findOne({ course: courseId }).populate({
    path: "modules.lectures",
    model: "Lecture",
    select:
      "title content videoUrl videoKey moduleNumber lectureOrder isReviewed reviewDeadline createdAt updatedAt",
  });

  if (!syllabus) return null;

  // Process and sort lectures
  return {
    ...syllabus.toObject(),
    modules: syllabus.modules.map((module) => ({
      ...module.toObject(),
      // Sort lectures by order
      lectures: module.lectures
        ? [...module.lectures].sort(
            (a, b) => (a.lectureOrder || 0) - (b.lectureOrder || 0)
          )
        : [],
    })),
  };
};

// SHARED UTILITY: Get lectures for course organized by modules
const getLecturesByModule = async (courseId) => {
  const lectures = await Lecture.find({
    course: courseId,
    isActive: true,
  })
    .select(
      "title content videoUrl videoKey syllabusModule moduleNumber lectureOrder isReviewed reviewDeadline createdAt updatedAt"
    )
    .sort({
      moduleNumber: 1,
      lectureOrder: 1,
    });

  // Group lectures by module
  const lecturesByModule = {};
  lectures.forEach((lecture) => {
    const moduleId = lecture.syllabusModule.toString();
    if (!lecturesByModule[moduleId]) {
      lecturesByModule[moduleId] = [];
    }
    lecturesByModule[moduleId].push({
      _id: lecture._id,
      title: lecture.title,
      content: lecture.content || "",
      videoUrl: lecture.videoUrl || "",
      videoKey: lecture.videoKey || "",
      moduleNumber: lecture.moduleNumber,
      lectureOrder: lecture.lectureOrder,
      isReviewed: lecture.isReviewed,
      reviewDeadline: lecture.reviewDeadline,
      createdAt: lecture.createdAt,
      updatedAt: lecture.updatedAt,
    });
  });

  return lecturesByModule;
};

// SIMPLIFIED: Enhanced helper function to format course data
const formatCourseData = async (course) => {
  // Convert Map to object for attendance sessions
  const attendanceSessions = {};
  if (course.attendance && course.attendance.sessions) {
    for (const [key, value] of course.attendance.sessions.entries()) {
      attendanceSessions[key] = value;
    }
  }

  // Get syllabus with lectures (using shared utility)
  let syllabusData = null;
  if (course.syllabus) {
    const populatedSyllabus = await getSyllabusWithLectures(course._id);

    if (populatedSyllabus) {
      // Get lectures organized by module (using shared utility)
      const lecturesByModule = await getLecturesByModule(course._id);

      syllabusData = {
        _id: populatedSyllabus._id,
        modules: populatedSyllabus.modules.map((module) => {
          const moduleId = module._id.toString();
          const moduleLectures = lecturesByModule[moduleId] || [];

          return {
            _id: module._id,
            moduleNumber: module.moduleNumber,
            moduleTitle: module.moduleTitle,
            description: module.description,
            isActive: module.isActive,
            order: module.order,

            // Only allowed content types
            videos: module.videos
              ? [...module.videos].sort(
                  (a, b) => (a.order || 0) - (b.order || 0)
                )
              : [],
            links: module.links
              ? [...module.links].sort(
                  (a, b) => (a.order || 0) - (b.order || 0)
                )
              : [],
            pdfs: module.pdfs
              ? [...module.pdfs].sort((a, b) => (a.order || 0) - (b.order || 0))
              : [],
            ppts: module.ppts
              ? [...module.ppts].sort((a, b) => (a.order || 0) - (b.order || 0))
              : [],

            lectures: moduleLectures, // Full lecture data with URLs

            // Content counts
            videoCount: module.videos ? module.videos.length : 0,
            linkCount: module.links ? module.links.length : 0,
            pdfCount: module.pdfs ? module.pdfs.length : 0,
            pptCount: module.ppts ? module.ppts.length : 0,
            lectureCount: moduleLectures.length,

            hasContent:
              module.videos?.length > 0 ||
              module.links?.length > 0 ||
              module.pdfs?.length > 0 ||
              module.ppts?.length > 0 ||
              moduleLectures.length > 0,
          };
        }),
        createdAt: populatedSyllabus.createdAt,
        updatedAt: populatedSyllabus.updatedAt,
      };
    }
  }

  // Get lecture statistics
  const totalLectureCount = await Lecture.countDocuments({
    course: course._id,
    isActive: true,
  });

  const reviewedLectureCount = await Lecture.countDocuments({
    course: course._id,
    isActive: true,
    isReviewed: true,
  });

  const overallCompletion =
    totalLectureCount > 0
      ? Math.round((reviewedLectureCount / totalLectureCount) * 100)
      : 0;

  return {
    _id: course._id,
    title: course.title,
    aboutCourse: course.aboutCourse,
    courseCode: course.courseCode,
    semester: course.semester,
    teacher: course.teacher,
    creditPoints: course.creditPoints
      ? {
          lecture: course.creditPoints.lecture,
          tutorial: course.creditPoints.tutorial,
          practical: course.creditPoints.practical,
          project: course.creditPoints.project,
        }
      : {
          lecture: 0,
          tutorial: 0,
          practical: 0,
          project: 0,
        },
    learningOutcomes: course.outcomes ? course.outcomes.outcomes : [],
    weeklyPlan: course.weeklyPlan
      ? course.weeklyPlan.weeks.map((week) => ({
          weekNumber: week.weekNumber,
          topics: week.topics,
        }))
      : [],
    syllabus: syllabusData,
    courseSchedule: course.schedule
      ? {
          classStartDate: course.schedule.classStartDate,
          classEndDate: course.schedule.classEndDate,
          midSemesterExamDate: course.schedule.midSemesterExamDate,
          endSemesterExamDate: course.schedule.endSemesterExamDate,
          classDaysAndTimes: course.schedule.classDaysAndTimes.map((day) => ({
            day: day.day,
            time: day.time,
          })),
        }
      : {
          classStartDate: "",
          classEndDate: "",
          midSemesterExamDate: "",
          endSemesterExamDate: "",
          classDaysAndTimes: [],
        },
    totalLectureCount,
    reviewedLectureCount,
    overallCompletion,
    attendance: {
      sessions: attendanceSessions,
    },
  };
};

// SIMPLIFIED: Get specific course by ID
const getCourseById = async function (req, res) {
  try {
    logger.info(
      `Fetching course ID: ${req.params.courseId} for user: ${req.user.id}`
    );

    const userRole = req.user.role;
    let course,
      students = [];

    // Single course query with all necessary populations
    const courseQuery = Course.findById(req.params.courseId)
      .populate("semester")
      .populate("outcomes")
      .populate("schedule")
      .populate("syllabus")
      .populate("weeklyPlan")
      .populate("creditPoints")
      .populate("attendance");

    course = await courseQuery.exec();

    if (!course) {
      logger.error(`Course not found with ID: ${req.params.courseId}`);
      return res.status(404).json({ error: "Course not found" });
    }

    // Check access and get user details
    let hasAccess = false;
    let userDetails = null;

    if (userRole === "teacher") {
      const teacher = await Teacher.findOne({
        user: req.user.id,
        _id: course.teacher,
      }).populate({
        path: "user",
        select:
          "name email role mobileNo gender ageAsOn2025 fullPermanentAddress",
      });

      if (teacher) {
        // Check if teacher has access to this course code
        if (teacher.courseCodes.includes(course.courseCode)) {
          hasAccess = true;
          userDetails = {
            id: teacher._id,
            name: teacher.user?.name,
            email: teacher.email,
            mobileNo: teacher.user?.mobileNo,
            gender: teacher.user?.gender,
            age: teacher.user?.ageAsOn2025,
            address: teacher.user?.fullPermanentAddress,
          };

          // Get students for teacher - Only students with matching course code
          const studentsForCourse = await Student.find({
            teacher: teacher._id,
            courseCodes: course.courseCode,
          }).populate({
            path: "user",
            select:
              "name email mobileNo gender ageAsOn2025 bloodGroup fullPermanentAddress",
          });

          students =
            studentsForCourse?.map((student, index) => ({
              id: student._id.toString(),
              rollNo: `CS${String(index + 101).padStart(3, "0")}`,
              name: student.user?.name || "Unknown",
              program: "Computer Science",
              email: student.user?.email || "",
              mobileNo: student.user?.mobileNo || "",
              gender: student.user?.gender || "",
              age: student.user?.ageAsOn2025 || null,
              bloodGroup: student.user?.bloodGroup || "",
              address: student.user?.fullPermanentAddress || "",
              courseCodes: student.courseCodes,
            })) || [];
        }
      }
    } else if (userRole === "student") {
      const student = await Student.findOne({ user: req.user.id }).populate({
        path: "user",
        select:
          "name email role mobileNo gender ageAsOn2025 bloodGroup fullPermanentAddress fullCorrespondenceAddress",
      });

      if (student) {
        // Check if student has access to this course code
        const isEnrolledInCourse = student.courses.some(
          (id) => id.toString() === req.params.courseId
        );
        const hasMatchingCourseCode = student.courseCodes.includes(
          course.courseCode
        );

        if (isEnrolledInCourse && hasMatchingCourseCode) {
          hasAccess = true;
          userDetails = {
            id: student._id,
            name: student.user?.name,
            email: student.user?.email,
            mobileNo: student.user?.mobileNo,
            gender: student.user?.gender,
            age: student.user?.ageAsOn2025,
            bloodGroup: student.user?.bloodGroup,
            permanentAddress: student.user?.fullPermanentAddress,
            correspondenceAddress: student.user?.fullCorrespondenceAddress,
          };
        }
      }
    }

    if (!hasAccess) {
      logger.error(
        `User ${req.user.id} does not have access to course ${req.params.courseId} with course code ${course.courseCode}`
      );
      return res
        .status(403)
        .json({ error: "You don't have access to this course" });
    }

    logger.info(`Found course: ${course.title} (${course.courseCode})`);

    // Format course data using shared utility
    const formattedCourse = await formatCourseData(course);

    const response = {
      id: formattedCourse._id,
      title: formattedCourse.title,
      aboutCourse: formattedCourse.aboutCourse,
      courseCode: formattedCourse.courseCode,
      semester: formattedCourse.semester,
      creditPoints: formattedCourse.creditPoints,
      learningOutcomes: formattedCourse.learningOutcomes,
      weeklyPlan: formattedCourse.weeklyPlan,
      syllabus: formattedCourse.syllabus,
      courseSchedule: formattedCourse.courseSchedule,
      totalLectureCount: formattedCourse.totalLectureCount,
      reviewedLectureCount: formattedCourse.reviewedLectureCount,
      overallCompletion: formattedCourse.overallCompletion,
      attendance: formattedCourse.attendance,
    };

    if (userRole === "teacher") {
      response.teacher = {
        id: userDetails.id,
        name: userDetails.name,
        email: userDetails.email,
        mobileNo: userDetails.mobileNo,
        gender: userDetails.gender,
        age: userDetails.age,
        address: userDetails.address,
        totalStudents: students.length,
      };
      response.students = students;
    } else if (userRole === "student") {
      response.student = {
        id: userDetails.id,
        name: userDetails.name,
        email: userDetails.email,
        mobileNo: userDetails.mobileNo,
        gender: userDetails.gender,
        age: userDetails.age,
        bloodGroup: userDetails.bloodGroup,
        permanentAddress: userDetails.permanentAddress,
        correspondenceAddress: userDetails.correspondenceAddress,
      };
      const courseTeacher = await Teacher.findById(course.teacher).populate({
        path: "user",
        select: "name email mobileNo",
      });
      if (courseTeacher) {
        response.teacher = {
          id: courseTeacher._id,
          name: courseTeacher.user?.name,
          email: courseTeacher.user?.email,
          mobileNo: courseTeacher.user?.mobileNo,
        };
      }
    }

    res.json(response);
  } catch (error) {
    logger.error("Error in getCourseById:", error);
    res.status(500).json({ error: error.message });
  }
};

// UNIFIED: Get user courses (same response format for both teacher/student)
const getUserCourses = async function (req, res) {
  try {
    logger.info(`Fetching courses for user with ID: ${req.user.id}`);
    const userRole = req.user.role;

    if (userRole === "teacher") {
      // TEACHER LOGIC - with course code filtering
      const teacher = await Teacher.findOne({ user: req.user.id }).populate({
        path: "user",
        select: "name email role mobileNo gender ageAsOn2025",
      });

      if (!teacher) {
        logger.error(`Teacher not found for user ID: ${req.user.id}`);
        return res.status(404).json({ error: "Teacher not found" });
      }

      // Filter courses by teacher's course codes
      const courses = await Course.find({
        teacher: teacher._id,
        courseCode: { $in: teacher.courseCodes },
      })
        .select(
          "_id title aboutCourse courseCode assignments attendance schedule semester"
        )
        .populate(
          "assignments",
          "_id title description dueDate totalPoints isActive submissions"
        )
        .populate("attendance", "sessions")
        .populate(
          "schedule",
          "classStartDate classEndDate midSemesterExamDate endSemesterExamDate classDaysAndTimes"
        )
        .populate("semester", "_id name startDate endDate")
        .sort({ createdAt: -1 });

      logger.info(
        `Found ${courses.length} courses for teacher: ${
          teacher._id
        } with course codes: ${teacher.courseCodes.join(", ")}`
      );

      const coursesWithData = await Promise.all(
        courses.map(async (course) => {
          const lectureCount = await Lecture.countDocuments({
            course: course._id,
            isActive: true,
          });

          return {
            _id: course._id,
            title: course.title,
            aboutCourse: course.aboutCourse,
            courseCode: course.courseCode,
            semester: course.semester
              ? {
                  _id: course.semester._id,
                  name: course.semester.name,
                  startDate: course.semester.startDate,
                  endDate: course.semester.endDate,
                }
              : null,
            schedule: course.schedule
              ? {
                  _id: course.schedule._id,
                  classStartDate: course.schedule.classStartDate,
                  classEndDate: course.schedule.classEndDate,
                  midSemesterExamDate: course.schedule.midSemesterExamDate,
                  endSemesterExamDate: course.schedule.endSemesterExamDate,
                  classDaysAndTimes: course.schedule.classDaysAndTimes || [],
                }
              : null,
            assignmentCount: course.assignments ? course.assignments.length : 0,
            lectureCount,
            assignments: course.assignments
              ? course.assignments.map((assignment) => ({
                  _id: assignment._id,
                  title: assignment.title,
                  description: assignment.description,
                  dueDate: assignment.dueDate,
                  totalPoints: assignment.totalPoints,
                  isActive: assignment.isActive,
                  submissions: assignment.submissions
                    ? assignment.submissions.map((submission) => ({
                        _id: submission._id,
                        student: submission.student,
                        submissionDate: submission.submissionDate,
                        submissionFile: submission.submissionFile,
                        grade: submission.grade,
                        feedback: submission.feedback,
                        status: submission.status,
                      }))
                    : [],
                }))
              : [],
            attendance:
              course.attendance && course.attendance.sessions
                ? Object.fromEntries(course.attendance.sessions)
                : {},
          };
        })
      );

      return res.json({
        user: {
          _id: teacher._id,
          name: teacher.user?.name,
          email: teacher.email,
          role: "teacher",
          mobileNo: teacher.user?.mobileNo,
          gender: teacher.user?.gender,
          age: teacher.user?.ageAsOn2025,
          courseCodes: teacher.courseCodes,
          totalCourses: courses.length || 0,
        },
        courses: coursesWithData,
      });
    } else if (userRole === "student") {
      // STUDENT LOGIC - with course code filtering
      const student = await Student.findOne({ user: req.user.id }).populate({
        path: "user",
        select: "name email role mobileNo gender ageAsOn2025 bloodGroup",
      });

      if (!student) {
        logger.error(`Student not found for user ID: ${req.user.id}`);
        return res.status(404).json({ error: "Student not found" });
      }

      const courseIds = student.courses || [];

      if (courseIds.length === 0) {
        logger.info(`Student ${student._id} is not enrolled in any courses`);
        return res.json({
          user: {
            _id: student._id,
            name: student.user?.name,
            email: student.user?.email,
            role: "student",
            mobileNo: student.user?.mobileNo,
            gender: student.user?.gender,
            age: student.user?.ageAsOn2025,
            bloodGroup: student.user?.bloodGroup,
            courseCodes: student.courseCodes,
            totalCourses: 0,
          },
          courses: [],
        });
      }

      // Filter courses by student's course codes
      const courses = await Course.find({
        _id: { $in: courseIds },
        courseCode: { $in: student.courseCodes },
      })
        .select(
          "_id title aboutCourse courseCode assignments attendance schedule semester"
        )
        .populate(
          "assignments",
          "_id title description dueDate totalPoints isActive submissions"
        )
        .populate("attendance", "sessions")
        .populate(
          "schedule",
          "classStartDate classEndDate midSemesterExamDate endSemesterExamDate classDaysAndTimes"
        )
        .populate("semester", "_id name startDate endDate")
        .sort({ createdAt: -1 });

      const coursesWithData = await Promise.all(
        courses.map(async (course) => {
          const lectureCount = await Lecture.countDocuments({
            course: course._id,
            isActive: true,
          });

          return {
            _id: course._id,
            title: course.title,
            aboutCourse: course.aboutCourse,
            courseCode: course.courseCode,
            semester: course.semester
              ? {
                  _id: course.semester._id,
                  name: course.semester.name,
                  startDate: course.semester.startDate,
                  endDate: course.semester.endDate,
                }
              : null,
            schedule: course.schedule
              ? {
                  _id: course.schedule._id,
                  classStartDate: course.schedule.classStartDate,
                  classEndDate: course.schedule.classEndDate,
                  midSemesterExamDate: course.schedule.midSemesterExamDate,
                  endSemesterExamDate: course.schedule.endSemesterExamDate,
                  classDaysAndTimes: course.schedule.classDaysAndTimes || [],
                }
              : null,
            assignmentCount: course.assignments ? course.assignments.length : 0,
            lectureCount,
            // Filter assignments to show only student's own submissions
            assignments: course.assignments
              ? course.assignments.map((assignment) => ({
                  _id: assignment._id,
                  title: assignment.title,
                  description: assignment.description,
                  dueDate: assignment.dueDate,
                  totalPoints: assignment.totalPoints,
                  isActive: assignment.isActive,
                  // Only show student's own submissions
                  submissions: assignment.submissions
                    ? assignment.submissions
                        .filter((submission) =>
                          submission.student.equals(student._id)
                        )
                        .map((submission) => ({
                          _id: submission._id,
                          student: submission.student,
                          submissionDate: submission.submissionDate,
                          submissionFile: submission.submissionFile,
                          grade: submission.grade,
                          feedback: submission.feedback,
                          status: submission.status,
                        }))
                    : [],
                }))
              : [],
            attendance:
              course.attendance && course.attendance.sessions
                ? Object.fromEntries(course.attendance.sessions)
                : {},
          };
        })
      );

      logger.info(
        `Found ${courses.length} enrolled courses for student: ${
          student._id
        } with course codes: ${student.courseCodes.join(", ")}`
      );

      return res.json({
        user: {
          _id: student._id,
          name: student.user?.name,
          email: student.user?.email,
          role: "student",
          mobileNo: student.user?.mobileNo,
          gender: student.user?.gender,
          age: student.user?.ageAsOn2025,
          bloodGroup: student.user?.bloodGroup,
          courseCodes: student.courseCodes,
          totalCourses: courses.length || 0,
        },
        courses: coursesWithData,
      });
    } else {
      return res.status(403).json({ error: "Invalid user role" });
    }
  } catch (error) {
    logger.error("Error in getUserCourses:", error);
    res.status(500).json({ error: error.message });
  }
};

// SIMPLIFIED: Get enrolled courses for students
const getEnrolledCourses = async function (req, res) {
  try {
    logger.info(
      `Fetching enrolled courses for student with ID: ${req.user.id}`
    );

    if (req.user.role !== "student") {
      logger.error(`User ${req.user.id} is not a student`);
      return res
        .status(403)
        .json({ error: "Access denied. Student role required" });
    }

    const student = await Student.findOne({ user: req.user.id }).populate({
      path: "user",
      select:
        "name email role mobileNo gender ageAsOn2025 bloodGroup fullPermanentAddress",
    });

    if (!student) {
      logger.error(`Student not found for user ID: ${req.user.id}`);
      return res.status(404).json({ error: "Student not found" });
    }

    const courseIds = student.courses || [];

    if (courseIds.length === 0) {
      logger.info(`Student ${student._id} is not enrolled in any courses`);
      return res.json({
        user: {
          _id: student._id,
          name: student.user?.name,
          email: student.user?.email,
          role: "student",
          mobileNo: student.user?.mobileNo,
          gender: student.user?.gender,
          age: student.user?.ageAsOn2025,
          bloodGroup: student.user?.bloodGroup,
          address: student.user?.fullPermanentAddress,
          courseCodes: student.courseCodes,
          totalCourses: 0,
        },
        courses: [],
      });
    }

    // Simple course query without complex populations - filtered by course codes
    const courses = await Course.find({
      _id: { $in: courseIds },
      courseCode: { $in: student.courseCodes },
    })
      .select("_id title aboutCourse courseCode")
      .populate("semester", "name startDate endDate")
      .sort({ createdAt: -1 });

    // Get lecture counts efficiently
    const coursesWithLectureCounts = await Promise.all(
      courses.map(async (course) => {
        const lectureCount = await Lecture.countDocuments({
          course: course._id,
          isActive: true,
        });

        return {
          _id: course._id,
          title: course.title,
          aboutCourse: course.aboutCourse,
          courseCode: course.courseCode,
          semester: course.semester
            ? {
                _id: course.semester._id,
                name: course.semester.name,
                startDate: course.semester.startDate,
                endDate: course.semester.endDate,
              }
            : null,
          lectureCount,
        };
      })
    );

    logger.info(
      `Found ${courses.length} enrolled courses for student: ${
        student._id
      } with course codes: ${student.courseCodes.join(", ")}`
    );

    res.json({
      user: {
        _id: student._id,
        name: student.user?.name,
        email: student.user?.email,
        role: "student",
        mobileNo: student.user?.mobileNo,
        gender: student.user?.gender,
        age: student.user?.ageAsOn2025,
        bloodGroup: student.user?.bloodGroup,
        address: student.user?.fullPermanentAddress,
        courseCodes: student.courseCodes,
        totalCourses: courses.length || 0,
      },
      courses: coursesWithLectureCounts,
    });
  } catch (error) {
    logger.error("Error in getEnrolledCourses:", error);
    res.status(500).json({ error: error.message });
  }
};

// Create new course (simplified syllabus creation)
const createCourse = async function (req, res) {
  logger.info("Starting createCourse controller function");

  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    logger.info("Attempting to start transaction");
    await session.startTransaction();
    transactionStarted = true;
    logger.info("Transaction started successfully");

    // Find teacher using the logged-in user ID
    const teacher = await Teacher.findOne({ user: req.user.id }).session(
      session
    );

    if (!teacher) {
      logger.error(`Teacher not found for user ID: ${req.user.id}`);
      throw new Error("Teacher not found");
    }

    // Validate course code
    const { courseCode } = req.body;
    if (!courseCode) {
      throw new Error("Course code is required");
    }

    const normalizedCourseCode = courseCode.toUpperCase().trim();

    // Check if teacher is authorized to create course with this course code
    if (!teacher.courseCodes.includes(normalizedCourseCode)) {
      throw new Error(
        `You are not authorized to create courses with course code: ${normalizedCourseCode}. Your authorized course codes are: ${teacher.courseCodes.join(
          ", "
        )}`
      );
    }

    // Create main course
    const courseData = {
      title: req.body.title,
      aboutCourse: req.body.aboutCourse,
      courseCode: normalizedCourseCode,
      semester: req.body.semester,
      teacher: teacher._id,
    };

    const course = new Course(courseData);
    await course.save({ session });
    logger.info(
      `Main course created with ID: ${course._id} and course code: ${course.courseCode}`
    );

    // Create learning outcomes
    if (req.body.learningOutcomes && req.body.learningOutcomes.length > 0) {
      logger.info("Creating learning outcomes");
      const outcome = await CourseOutcome.create(
        [
          {
            outcomes: req.body.learningOutcomes,
            course: course._id,
          },
        ],
        { session }
      );
      course.outcomes = outcome[0]._id;
      logger.info(`Learning outcomes created with ID: ${outcome[0]._id}`);
    }

    // Create course schedule
    if (req.body.courseSchedule) {
      logger.info("Creating course schedule");
      const scheduleData = {
        ...req.body.courseSchedule,
        course: course._id,
      };
      const schedule = await CourseSchedule.create([scheduleData], { session });
      course.schedule = schedule[0]._id;
      logger.info(`Course schedule created with ID: ${schedule[0]._id}`);
    }

    // Create simplified syllabus with only required content types
    if (
      req.body.syllabus &&
      req.body.syllabus.modules &&
      req.body.syllabus.modules.length > 0
    ) {
      logger.info("Creating course syllabus");

      const modulesData = req.body.syllabus.modules.map((module, index) => ({
        moduleNumber: module.moduleNumber || index + 1,
        moduleTitle: module.moduleTitle || `Module ${index + 1}`,
        description: module.description || "",
        videos: module.videos || [],
        links: module.links || [],
        pdfs: module.pdfs || [],
        ppts: module.ppts || [],
        lectures: [],
        isActive: true,
        order: index + 1,
      }));

      const syllabus = await CourseSyllabus.create(
        [
          {
            modules: modulesData,
            course: course._id,
          },
        ],
        { session }
      );

      course.syllabus = syllabus[0]._id;
      logger.info(`Course syllabus created with ID: ${syllabus[0]._id}`);
    }

    // Create weekly plan
    if (req.body.weeklyPlan && req.body.weeklyPlan.length > 0) {
      logger.info("Creating weekly plan");
      const weeklyPlan = await WeeklyPlan.create(
        [
          {
            weeks: req.body.weeklyPlan,
            course: course._id,
          },
        ],
        { session }
      );
      course.weeklyPlan = weeklyPlan[0]._id;
      logger.info(`Weekly plan created with ID: ${weeklyPlan[0]._id}`);
    }

    // Create credit points
    if (req.body.creditPoints) {
      logger.info("Creating credit points");
      const creditPoints = await CreditPoints.create(
        [
          {
            ...req.body.creditPoints,
            course: course._id,
          },
        ],
        { session }
      );
      course.creditPoints = creditPoints[0]._id;
      logger.info(`Credit points created with ID: ${creditPoints[0]._id}`);
    }

    // Create attendance if provided
    if (req.body.attendance && req.body.attendance.sessions) {
      logger.info("Creating course attendance");
      const sessionsMap = new Map(Object.entries(req.body.attendance.sessions));
      const attendance = await CourseAttendance.create(
        [
          {
            sessions: sessionsMap,
            course: course._id,
          },
        ],
        { session }
      );
      course.attendance = attendance[0]._id;
      logger.info(`Course attendance created with ID: ${attendance[0]._id}`);
    }

    // Save updated course with all references
    logger.info("Saving updated course with all references");
    await course.save({ session });

    // Add course to teacher's courses array
    logger.info("Adding course to teacher's courses array");
    teacher.courses.push(course._id);
    await teacher.save({ session });

    // Find all students under this teacher with matching course code and add the course to their courses array
    logger.info(
      `Finding students for teacher: ${teacher._id} with course code: ${normalizedCourseCode}`
    );
    const students = await Student.find({
      teacher: teacher._id,
      courseCodes: normalizedCourseCode,
    }).session(session);

    // Add course ID to matching students' courses arrays
    if (students && students.length > 0) {
      logger.info(
        `Adding course to ${students.length} students' course arrays with matching course code`
      );
      const updatePromises = students.map((student) => {
        if (!student.courses.includes(course._id)) {
          student.courses.push(course._id);
          return student.save({ session });
        }
        return Promise.resolve();
      });

      await Promise.all(updatePromises);
      logger.info(`All matching students updated successfully`);
    } else {
      logger.info(
        `No students found with course code: ${normalizedCourseCode}`
      );
    }

    logger.info("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    logger.info("Transaction committed successfully");

    // Get the fully populated course using shared utility
    logger.info("Fetching fully populated course");
    const courseQuery = Course.findById(course._id)
      .populate("semester")
      .populate("outcomes")
      .populate("schedule")
      .populate("syllabus")
      .populate("weeklyPlan")
      .populate("creditPoints")
      .populate("attendance");

    const createdCourse = await courseQuery.exec();
    const formattedCourse = await formatCourseData(createdCourse);

    logger.info("Sending response with formatted course data");
    res.status(201).json(formattedCourse);
  } catch (error) {
    logger.error("Error in createCourse:", error);

    if (transactionStarted) {
      try {
        logger.info("Aborting transaction due to error");
        await session.abortTransaction();
        logger.info("Transaction aborted successfully");
      } catch (abortError) {
        logger.error("Error aborting transaction:", abortError);
      }
    }

    res.status(400).json({ error: error.message });
  } finally {
    logger.info("Ending database session");
    await session.endSession();
    logger.info("Session ended");
  }
};

// Update course (simplified)
const updateCourse = async function (req, res) {
  logger.info(`Updating course ID: ${req.params.courseId}`);

  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    logger.info("Transaction started successfully");

    const teacher = await Teacher.findOne({ user: req.user.id }).session(
      session
    );
    if (!teacher) {
      logger.error(`Teacher not found for user ID: ${req.user.id}`);
      throw new Error("Teacher not found");
    }

    const course = await Course.findOne({
      _id: req.params.courseId,
      teacher: teacher._id,
    });

    if (!course) {
      logger.error(
        `Course not found with ID: ${req.params.courseId} for teacher: ${teacher._id}`
      );
      throw new Error("Course not found or unauthorized access");
    }

    logger.info(`Found course: ${course.title} (${course.courseCode})`);

      const newCourseCode = req.body.courseCode.toUpperCase().trim();

      // Check if teacher is authorized for the new course code
      if (!teacher.courseCodes.includes(newCourseCode)) {
        throw new Error(
          `You are not authorized to use course code: ${newCourseCode}. Your authorized course codes are: ${teacher.courseCodes.join(
            ", "
          )}`
        );
      }

      const oldCourseCode = course.courseCode;

      // Update main course fields
      course.courseCode = newCourseCode;

      // If course code changed, update student enrollments
      if (oldCourseCode !== newCourseCode) {
        logger.info(
          `Course code changed from ${oldCourseCode} to ${newCourseCode}`
        );

        // Remove course from students with old course code who don't have new course code
        const studentsWithOldCode = await Student.find({
          teacher: teacher._id,
          courseCodes: oldCourseCode,
          courseCodes: { $nin: [newCourseCode] }, // Don't have new course code
          courses: course._id,
        }).session(session);

        for (const student of studentsWithOldCode) {
          student.courses = student.courses.filter(
            (id) => !id.equals(course._id)
          );
          await student.save({ session });
        }

        // Add course to students with new course code who don't already have it
        const studentsWithNewCode = await Student.find({
          teacher: teacher._id,
          courseCodes: newCourseCode,
          courses: { $nin: [course._id] }, // Don't already have the course
        }).session(session);

        for (const student of studentsWithNewCode) {
          student.courses.push(course._id);
          await student.save({ session });
        }

        logger.info(`Updated student enrollments for course code change`);
      }
    }

    // Update other main course fields
    if (req.body.title) course.title = req.body.title;
    if (req.body.aboutCourse) course.aboutCourse = req.body.aboutCourse;
    if (req.body.semester) course.semester = req.body.semester;

    await course.save({ session });
    logger.info("Updated main course fields");

    // Update learning outcomes
    if (req.body.learningOutcomes) {
      if (course.outcomes) {
        await CourseOutcome.findByIdAndUpdate(
          course.outcomes,
          { outcomes: req.body.learningOutcomes },
          { session }
        );
        logger.info(`Updated existing learning outcomes: ${course.outcomes}`);
      } else {
        const outcome = await CourseOutcome.create(
          [
            {
              outcomes: req.body.learningOutcomes,
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
    if (req.body.courseSchedule) {
      if (course.schedule) {
        await CourseSchedule.findByIdAndUpdate(
          course.schedule,
          req.body.courseSchedule,
          { session }
        );
        logger.info(`Updated existing schedule: ${course.schedule}`);
      } else {
        const schedule = await CourseSchedule.create(
          [
            {
              ...req.body.courseSchedule,
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
    if (req.body.weeklyPlan) {
      if (course.weeklyPlan) {
        await WeeklyPlan.findByIdAndUpdate(
          course.weeklyPlan,
          { weeks: req.body.weeklyPlan },
          { session }
        );
        logger.info(`Updated existing weekly plan: ${course.weeklyPlan}`);
      } else {
        const weeklyPlan = await WeeklyPlan.create(
          [
            {
              weeks: req.body.weeklyPlan,
              course: course._id,
            },
          ],
          { session }
        );
        course.weeklyPlan = weeklyPlan[0]._id;
        await course.save({ session });
        logger.info(`Created new weekly plan: ${weeklyPlan[0]._id}`);
      }
    }

    // Update credit points
    if (req.body.creditPoints) {
      if (course.creditPoints) {
        await CreditPoints.findByIdAndUpdate(
          course.creditPoints,
          req.body.creditPoints,
          { session }
        );
        logger.info(`Updated existing credit points: ${course.creditPoints}`);
      } else {
        const creditPoints = await CreditPoints.create(
          [
            {
              ...req.body.creditPoints,
              course: course._id,
            },
          ],
          { session }
        );
        course.creditPoints = creditPoints[0]._id;
        await course.save({ session });
        logger.info(`Created new credit points: ${creditPoints[0]._id}`);
      }
    }

    // Update attendance
    if (req.body.attendance && req.body.attendance.sessions) {
      const sessionsMap = new Map(Object.entries(req.body.attendance.sessions));

      if (course.attendance) {
        await CourseAttendance.findByIdAndUpdate(
          course.attendance,
          { sessions: sessionsMap },
          { session }
        );
        logger.info(`Updated existing attendance: ${course.attendance}`);
      } else {
        const attendance = await CourseAttendance.create(
          [
            {
              sessions: sessionsMap,
              course: course._id,
            },
          ],
          { session }
        );
        course.attendance = attendance[0]._id;
        await course.save({ session });
        logger.info(`Created new attendance: ${attendance[0]._id}`);
      }
    }

    logger.info("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    logger.info("Transaction committed successfully");

    // Get updated course with all populated fields using shared utility
    const courseQuery = Course.findById(course._id)
      .populate("semester")
      .populate("outcomes")
      .populate("schedule")
      .populate("syllabus")
      .populate("weeklyPlan")
      .populate("creditPoints")
      .populate("attendance");

    const updatedCourse = await courseQuery.exec();
    const formattedCourse = await formatCourseData(updatedCourse);
    res.json(formattedCourse);
  } catch (error) {
    logger.error("Error in updateCourse:", error);

    if (transactionStarted) {
      try {
        await session.abortTransaction();
        logger.info("Transaction aborted successfully");
      } catch (abortError) {
        logger.error("Error aborting transaction:", abortError);
      }
    }
    res.status(400).json({ error: error.message });
  } finally {
    await session.endSession();
    logger.info("Session ended");
  }
};

// Delete course and all related data
const deleteCourse = async function (req, res) {
  logger.info(`Deleting course ID: ${req.params.courseId}`);

  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    logger.info("Transaction started successfully");

    const teacher = await Teacher.findOne({ user: req.user.id }).session(
      session
    );
    if (!teacher) {
      logger.error(`Teacher not found for user ID: ${req.user.id}`);
      throw new Error("Teacher not found");
    }

    const course = await Course.findOne({
      _id: req.params.courseId,
      teacher: teacher._id,
    }).session(session);

    if (!course) {
      logger.error(`Course not found with ID: ${req.params.courseId}`);
      throw new Error("Course not found");
    }

    logger.info(`Deleting course: ${course.title} (${course.courseCode})`);

    // Delete all related documents
    if (course.outcomes) {
      await CourseOutcome.findByIdAndDelete(course.outcomes, { session });
      logger.info(`Deleted course outcomes: ${course.outcomes}`);
    }

    if (course.schedule) {
      await CourseSchedule.findByIdAndDelete(course.schedule, { session });
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
        });

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
      }

      await CourseSyllabus.findByIdAndDelete(course.syllabus, { session });
      logger.info(`Deleted course syllabus: ${course.syllabus}`);
    }

    if (course.weeklyPlan) {
      await WeeklyPlan.findByIdAndDelete(course.weeklyPlan, { session });
      logger.info(`Deleted weekly plan: ${course.weeklyPlan}`);
    }

    if (course.creditPoints) {
      await CreditPoints.findByIdAndDelete(course.creditPoints, { session });
      logger.info(`Deleted credit points: ${course.creditPoints}`);
    }

    if (course.attendance) {
      await CourseAttendance.findByIdAndDelete(course.attendance, { session });
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

    await Lecture.deleteMany({ course: course._id }, { session });
    logger.info(`Deleted all lectures for course: ${course._id}`);

    // Remove course from teacher's courses
    teacher.courses = teacher.courses.filter((id) => !id.equals(course._id));
    await teacher.save({ session });
    logger.info(`Removed course from teacher's courses list`);

    // Update students who have this course - remove it from their courses array
    const students = await Student.find({
      courses: course._id,
    }).session(session);

    if (students && students.length > 0) {
      logger.info(
        `Removing course from ${students.length} students' course lists`
      );
      const updatePromises = students.map((student) => {
        student.courses = student.courses.filter(
          (id) => !id.equals(course._id)
        );
        return student.save({ session });
      });

      await Promise.all(updatePromises);
      logger.info(`Successfully removed course from all students' lists`);
    }

    // Delete the course
    await Course.findByIdAndDelete(course._id, { session });
    logger.info(`Deleted course: ${course._id}`);

    logger.info("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    logger.info("Transaction committed successfully");

    res.json({ message: "Course deleted successfully" });
  } catch (error) {
    logger.error("Error in deleteCourse:", error);

    if (transactionStarted) {
      try {
        await session.abortTransaction();
        logger.info("Transaction aborted successfully");
      } catch (abortError) {
        logger.error("Error aborting transaction:", abortError);
      }
    }
    res.status(400).json({ error: error.message });
  } finally {
    await session.endSession();
    logger.info("Session ended");
  }
};

// Update attendance only
const updateCourseAttendance = async function (req, res) {
  logger.info(`Updating attendance for course ID: ${req.params.courseId}`);

  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    await session.startTransaction();
    transactionStarted = true;
    logger.info("Transaction started successfully");

    const teacher = await Teacher.findOne({ user: req.user.id }).session(
      session
    );
    if (!teacher) {
      logger.error(`Teacher not found for user ID: ${req.user.id}`);
      throw new Error("Teacher not found");
    }

    const course = await Course.findOne({
      _id: req.params.courseId,
      teacher: teacher._id,
    }).session(session);

    if (!course) {
      logger.error(`Course not found with ID: ${req.params.courseId}`);
      throw new Error("Course not found");
    }

    if (req.body.sessions) {
      const sessionsMap = new Map(Object.entries(req.body.sessions));

      if (course.attendance) {
        await CourseAttendance.findByIdAndUpdate(
          course.attendance,
          { sessions: sessionsMap },
          { session }
        );
        logger.info(`Updated existing attendance: ${course.attendance}`);
      } else {
        const attendance = await CourseAttendance.create(
          [
            {
              sessions: sessionsMap,
              course: course._id,
            },
          ],
          { session }
        );
        course.attendance = attendance[0]._id;
        await course.save({ session });
        logger.info(`Created new attendance: ${attendance[0]._id}`);
      }
    }

    logger.info("Committing transaction");
    await session.commitTransaction();
    transactionStarted = false;
    logger.info("Transaction committed successfully");

    // Get updated course attendance
    const updatedCourse = await Course.findById(course._id).populate(
      "attendance"
    );

    // Format attendance for response
    const attendanceSessions = {};
    if (updatedCourse.attendance && updatedCourse.attendance.sessions) {
      for (const [key, value] of updatedCourse.attendance.sessions.entries()) {
        attendanceSessions[key] = value;
      }
    }

    res.json({
      _id: updatedCourse._id,
      courseCode: updatedCourse.courseCode,
      attendance: {
        sessions: attendanceSessions,
      },
    });
  } catch (error) {
    logger.error("Error in updateCourseAttendance:", error);

    if (transactionStarted) {
      try {
        await session.abortTransaction();
        logger.info("Transaction aborted successfully");
      } catch (abortError) {
        logger.error("Error aborting transaction:", abortError);
      }
    }
    res.status(400).json({ error: error.message });
  } finally {
    await session.endSession();
    logger.info("Session ended");
  }
};

module.exports = {
  getUserCourses,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  updateCourseAttendance,
  getEnrolledCourses,
};