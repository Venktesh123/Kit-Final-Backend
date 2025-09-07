const Semester = require("../models/Semester");

const createSemester = async (req, res) => {
  try {
    const { name, startDate, endDate } = req.body;

    const semester = new Semester({
      name,
      startDate,
      endDate,
    });

    await semester.save();
    res.status(201).json(semester);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getAllSemesters = async (req, res) => {
  try {
    const semesters = await Semester.find().populate("courses");
    res.json(semesters);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  createSemester,
  getAllSemesters,
};
