// Express error middleware for the failures the body parser raises before any
// route runs — an oversized body and a malformed JSON body. Without it those two
// are answered by Express's default handler as an HTML page, so they would be
// the only responses in the service not shaped like every other error.
function bodyErrorHandler({ bodyLimit, logger }) {
    return (err, req, res, next) => {
        if (!err) return next();
        const status = err.status || err.statusCode || 400;
        const error = err.type === 'entity.too.large'
            ? `Request body exceeds the ${bodyLimit} limit`
            : 'Malformed JSON body';
        if (logger) logger.warn({ requestId: req.requestId, status, type: err.type }, 'Rejected request body');
        return res.status(status).json({ error, request_id: req.requestId });
    };
}

module.exports = { bodyErrorHandler };
