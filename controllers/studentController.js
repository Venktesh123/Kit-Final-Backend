const Course = require("../models/Course");
const Student = require("../models/Student");

const enrollCourse = async (req, res) => {
  try {
    // Find the course
    const course = await Course.findById(req.params.courseId);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    // Find the student
    const student = await Student.findOne({ user: req.user._id });
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // Check if student's teacher matches course's teacher
    if (course.teacher.toString() !== student.teacher.toString()) {
      return res.status(403).json({
        error: "You can only enroll in courses taught by your assigned teacher",
      });
    }

    // NEW: Check if student has the matching course code
    if (!student.courseCodes.includes(course.courseCode)) {
      return res.status(403).json({
        error: `You are not authorized to enroll in this course. Course code '${
          course.courseCode
        }' is not in your authorized course codes: ${student.courseCodes.join(
          ", "
        )}`,
      });
    }

    // Check if student is already enrolled
    if (student.courses.includes(course._id)) {
      return res.status(400).json({ error: "Already enrolled in this course" });
    }

    // Add course to student's courses
    student.courses.push(course._id);
    await student.save();

    // Note: We don't need to add student to course.students since we filter by course codes now

    return res.status(200).json({
      message: "Successfully enrolled in the course",
      course: {
        _id: course._id,
        title: course.title,
        aboutCourse: course.aboutCourse,
        courseCode: course.courseCode, // NEW: Include course code
      },
      student: {
        _id: student._id,
        courseCodes: student.courseCodes, // NEW: Include student's course codes
      },
    });
  } catch (error) {
    console.error("Error in enrollCourse:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  enrollCourse,
};
