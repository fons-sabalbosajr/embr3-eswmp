function getUploadErrorStatus(error) {
  if (error?.code === "LIMIT_FILE_SIZE") return 413;
  return 400;
}

function getUploadErrorMessage(error, maxSizeMb = 20) {
  if (error?.code === "LIMIT_FILE_SIZE") {
    return `File is too large. Please upload a file up to ${maxSizeMb} MB.`;
  }
  if (error?.code === "LIMIT_UNEXPECTED_FILE") {
    return "Unexpected file field. Please try uploading the correct attachment.";
  }
  return error?.message || "File upload failed. Please check the file and try again.";
}

function uploadSingle(upload, fieldName, options = {}) {
  const maxSizeMb = options.maxSizeMb || 20;
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (error) => {
      if (!error) return next();
      return res.status(getUploadErrorStatus(error)).json({
        message: getUploadErrorMessage(error, maxSizeMb),
      });
    });
  };
}

module.exports = {
  getUploadErrorMessage,
  getUploadErrorStatus,
  uploadSingle,
};
