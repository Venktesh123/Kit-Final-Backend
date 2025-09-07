const XLSX = require("xlsx");

// This middleware processes the Excel file directly from memory
module.exports = (req, res, next) => {
  console.log("Processing uploaded file...");

  try {
    // Check if we have any files (from the global middleware)
    if (!req.files || Object.keys(req.files).length === 0) {
      console.log("No files were uploaded");
      return res.status(400).json({ error: "No files were uploaded" });
    }

    // Get the uploaded file
    const uploadedFile = req.files.file;

    if (!uploadedFile) {
      return res.status(400).json({
        error: 'No file with name "file" was found',
        availableFields: Object.keys(req.files),
      });
    }

    console.log("File details:", {
      name: uploadedFile.name,
      size: uploadedFile.size,
      mimetype: uploadedFile.mimetype,
    });

    // Check for valid Excel file based on mimetype
    const validMimetypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/excel",
      "application/x-excel",
    ];

    // Check file extension too
    const fileExtension = uploadedFile.name.split(".").pop().toLowerCase();
    const isValidExtension = ["xlsx", "xls", "lsx"].includes(fileExtension);
    const isValidMimetype = validMimetypes.includes(uploadedFile.mimetype);

    // Accept file if EITHER extension OR mimetype is valid Excel
    if (!isValidExtension && !isValidMimetype) {
      return res.status(400).json({
        error: "Invalid file type. Only Excel files are allowed",
        details: {
          extension: fileExtension,
          mimetype: uploadedFile.mimetype,
        },
      });
    }

    // Process the Excel data directly from memory
    try {
      // Create a workbook from the data buffer
      const workbook = XLSX.read(uploadedFile.data, { type: "buffer" });

      // Get the first sheet name
      const firstSheetName = workbook.SheetNames[0];

      // Get the worksheet
      const worksheet = workbook.Sheets[firstSheetName];

      // Convert the worksheet to JSON
      const excelData = XLSX.utils.sheet_to_json(worksheet);

      // Create a req.excelData property with the parsed data
      req.excelData = excelData;

      // Create a mock file object for compatibility with existing code
      req.file = {
        fieldname: "file",
        originalname: uploadedFile.name,
        encoding: "utf8",
        mimetype: uploadedFile.mimetype,
        size: uploadedFile.size,
        // Instead of a physical path, provide the data in memory
        inMemory: true,
        excelData: excelData,
      };

      console.log(
        "Excel data extracted successfully:",
        excelData.length,
        "rows"
      );
      next();
    } catch (excelError) {
      console.error("Error parsing Excel data:", excelError);
      return res.status(400).json({
        error: "Failed to parse Excel file",
        details: excelError.message,
      });
    }
  } catch (error) {
    console.error("File processing error:", error);
    return res.status(500).json({
      error: "Error processing uploaded file",
      details: error.message,
    });
  }
};
