// An error that carries an HTTP status. Services throw it; errorHandler turns it into JSON.
// (Spring: a custom RuntimeException mapped by @ControllerAdvice.)
class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = AppError;
