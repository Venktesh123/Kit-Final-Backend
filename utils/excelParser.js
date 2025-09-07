const XLSX = require("xlsx");
const fs = require("fs").promises; // Using promises version of fs
const { validateUserData } = require("./validation");

const parseExcelFile = async (filePath) => {
  try {
    // Read file using Node's fs.promises
    const buffer = await fs.readFile(filePath);

    const workbook = XLSX.read(buffer, {
      type: "buffer", // Changed from 'array' to 'buffer'
      cellDates: true,
      cellNF: false,
      cellText: false,
    });

    // Verify we have at least one sheet
    if (!workbook.SheetNames.length) {
      throw new Error("Excel file is empty or invalid");
    }

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet);

    if (!data || !data.length) {
      throw new Error("No data found in Excel file");
    }

    // Validate and transform each row
    const validatedRows = [];
    const errors = [];

    for (const row of data) {
      try {
        // Basic validation
        if (!row.name || !row.email || !row.password || !row.role) {
          throw new Error(
            `Missing required fields in row: ${JSON.stringify(row)}`
          );
        }

        if (!["teacher", "student"].includes(row.role)) {
          throw new Error(`Invalid role "${row.role}" for user ${row.email}`);
        }

        if (row.role === "student" && !row.teacherEmail) {
          throw new Error(`Missing teacherEmail for student: ${row.email}`);
        }

        // Use Joi validation
        const validatedData = await validateUserData(row);
        if (validatedData) {
          validatedRows.push({
            name: validatedData.name,
            email: validatedData.email.toLowerCase(),
            password: validatedData.password,
            role: validatedData.role,
            teacherEmail: validatedData.teacherEmail
              ? validatedData.teacherEmail.toLowerCase()
              : "",
          });
        } else {
          errors.push(`Validation failed for row: ${JSON.stringify(row)}`);
        }
      } catch (rowError) {
        errors.push(rowError.message);
      }
    }

    // If no valid rows were found, throw error with all validation messages
    if (!validatedRows.length) {
      throw new Error(
        `No valid data found in Excel file. Errors:\n${errors.join("\n")}`
      );
    }

    // If some rows failed but others succeeded, log warnings but continue
    if (errors.length) {
      console.warn("Some rows failed validation:", errors);
    }

    return validatedRows;
  } catch (error) {
    // Handle specific file system errors
    if (error.code === "ENOENT") {
      throw new Error(`File not found: ${filePath}`);
    }
    if (error.code === "EACCES") {
      throw new Error(`Permission denied accessing file: ${filePath}`);
    }

    // Re-throw parsed Excel errors with more context
    throw new Error(`Error parsing Excel file: ${error.message}`);
  }
};

module.exports = { parseExcelFile };
