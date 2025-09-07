const { BlobServiceClient } = require("@azure/storage-blob");

// Initialize Azure Blob Service Client using only account name and key
const blobServiceClient = BlobServiceClient.fromConnectionString(
  `DefaultEndpointsProtocol=https;AccountName=${process.env.AZURE_STORAGE_ACCOUNT_NAME};AccountKey=${process.env.AZURE_STORAGE_ACCOUNT_KEY};EndpointSuffix=core.windows.net`
);

// Default container name - will be created automatically
const DEFAULT_CONTAINER_NAME = "lms-storage";

// Function to ensure container exists, create if not
const ensureContainerExists = async (
  containerName = DEFAULT_CONTAINER_NAME
) => {
  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);

    console.log(`Checking if container '${containerName}' exists...`);
    const exists = await containerClient.exists();

    if (!exists) {
      console.log(`Container '${containerName}' does not exist, creating...`);
      const createResponse = await containerClient.create({
        access: "blob", // Makes blobs publicly accessible
      });
      console.log(`Container '${containerName}' created successfully`);
      console.log("Create response:", createResponse.requestId);
    } else {
      console.log(`Container '${containerName}' already exists`);
    }

    return containerClient;
  } catch (error) {
    console.error(`Error ensuring container '${containerName}' exists:`, error);
    throw new Error(`Failed to ensure container exists: ${error.message}`);
  }
};

// Upload file to Azure Blob Storage
const uploadFileToAzure = async (
  file,
  path,
  containerName = DEFAULT_CONTAINER_NAME
) => {
  console.log("Uploading file to Azure Blob Storage");
  try {
    // Ensure container exists before uploading
    const containerClient = await ensureContainerExists(containerName);

    // Validate file data
    const fileContent = file.data;
    if (!fileContent) {
      throw new Error("No file content found");
    }

    // Generate a unique filename with sanitized name
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "-");
    const fileName = `${path}/${Date.now()}-${sanitizedFileName}`;

    console.log("Uploading file:", fileName);

    // Get a block blob client
    const blockBlobClient = containerClient.getBlockBlobClient(fileName);

    // Upload data to the blob
    const uploadResponse = await blockBlobClient.upload(
      fileContent,
      fileContent.length,
      {
        blobHTTPHeaders: {
          blobContentType: file.mimetype || "application/octet-stream",
        },
        metadata: {
          originalName: file.name,
          uploadDate: new Date().toISOString(),
          size: fileContent.length.toString(),
        },
      }
    );

    console.log("File uploaded successfully:", fileName);

    return {
      url: blockBlobClient.url,
      key: fileName,
      container: containerName,
      requestId: uploadResponse.requestId,
    };
  } catch (error) {
    console.error("Azure upload error:", error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
};

// Delete file from Azure Blob Storage
const deleteFileFromAzure = async (
  key,
  containerName = DEFAULT_CONTAINER_NAME
) => {
  console.log("Deleting file from Azure:", key);
  try {
    if (!key) {
      return { message: "No file key provided" };
    }

    // Get container client (don't create if it doesn't exist for delete operations)
    const containerClient = blobServiceClient.getContainerClient(containerName);

    // Check if container exists
    const containerExists = await containerClient.exists();
    if (!containerExists) {
      console.log(`Container '${containerName}' does not exist`);
      return { message: "Container does not exist" };
    }

    // Get blob client
    const blockBlobClient = containerClient.getBlockBlobClient(key);

    // Check if blob exists
    const blobExists = await blockBlobClient.exists();
    if (!blobExists) {
      console.log("File does not exist:", key);
      return { message: "File does not exist" };
    }

    // Delete the blob
    const deleteResponse = await blockBlobClient.delete();

    console.log("File deleted successfully");
    return {
      message: "File deleted successfully",
      requestId: deleteResponse.requestId,
    };
  } catch (error) {
    console.error("Azure delete error:", error);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
};

// List all containers in the storage account
const listContainers = async () => {
  try {
    console.log("Listing all containers...");
    const containers = [];

    for await (const container of blobServiceClient.listContainers()) {
      containers.push({
        name: container.name,
        lastModified: container.properties.lastModified,
        publicAccess: container.properties.publicAccess,
      });
    }

    console.log(`Found ${containers.length} containers`);
    return containers;
  } catch (error) {
    console.error("Error listing containers:", error);
    throw new Error(`Failed to list containers: ${error.message}`);
  }
};

// List files in a container with optional path filter
const listFiles = async (path = "", containerName = DEFAULT_CONTAINER_NAME) => {
  try {
    const containerClient = blobServiceClient.getContainerClient(containerName);

    // Check if container exists
    const exists = await containerClient.exists();
    if (!exists) {
      console.log(`Container '${containerName}' does not exist`);
      return [];
    }

    const files = [];
    const listOptions = path ? { prefix: path } : {};

    for await (const blob of containerClient.listBlobsFlat(listOptions)) {
      files.push({
        name: blob.name,
        url: `${containerClient.url}/${blob.name}`,
        size: blob.properties.contentLength,
        contentType: blob.properties.contentType,
        lastModified: blob.properties.lastModified,
        metadata: blob.metadata,
      });
    }

    return files;
  } catch (error) {
    console.error("Error listing files:", error);
    throw new Error(`Failed to list files: ${error.message}`);
  }
};

// Test Azure Storage connection
const testAzureConnection = async () => {
  try {
    console.log("Testing Azure Blob Storage connection...");

    // Test basic connection
    const accountInfo = await blobServiceClient.getAccountInfo();
    console.log("✅ Azure connection successful");
    console.log("Account kind:", accountInfo.accountKind);

    // Test container creation
    await ensureContainerExists(DEFAULT_CONTAINER_NAME);
    console.log("✅ Container initialization successful");

    // List existing containers
    const containers = await listContainers();
    console.log(`✅ Found ${containers.length} containers in storage account`);

    return {
      success: true,
      accountKind: accountInfo.accountKind,
      defaultContainer: DEFAULT_CONTAINER_NAME,
      containerCount: containers.length,
      containers: containers.map((c) => c.name),
    };
  } catch (error) {
    console.error("❌ Azure connection test failed:", error);
    throw new Error(`Azure connection failed: ${error.message}`);
  }
};

// Get storage account properties
const getStorageAccountInfo = async () => {
  try {
    const accountInfo = await blobServiceClient.getAccountInfo();
    const serviceProperties = await blobServiceClient.getProperties();

    return {
      accountKind: accountInfo.accountKind,
      skuName: accountInfo.skuName,
      cors: serviceProperties.cors,
      defaultServiceVersion: serviceProperties.defaultServiceVersion,
    };
  } catch (error) {
    console.error("Error getting storage account info:", error);
    throw new Error(`Failed to get storage account info: ${error.message}`);
  }
};

module.exports = {
  uploadFileToAzure,
  deleteFileFromAzure,
  ensureContainerExists,
  listContainers,
  listFiles,
  testAzureConnection,
  getStorageAccountInfo,
  blobServiceClient,
  DEFAULT_CONTAINER_NAME,
};
