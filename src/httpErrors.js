// Express error middleware for the failures the body parser raises before any
// route runs — an oversized body and a malformed JSON body. Without it those two
// are answered by Express's default handler as an HTML page, so they would be
// the only responses in the service not shaped like every other error.
function bodyErrorHandler({ bodyLimit, logger }) {
    return (err, req, res, next) => {
        if (!err) return next();
        const status = err.status || err.statusCode || 400;
        let error;
        switch (err.type) {
            case 'entity.too.large': error = `Request body exceeds the ${bodyLimit} limit`; break;
            case 'entity.parse.failed': error = 'Malformed JSON body'; break;
            case 'charset.unsupported': error = 'Unsupported charset; send the body as UTF-8'; break;
            case 'encoding.unsupported': error = 'Unsupported Content-Encoding; send the body uncompressed or as gzip, deflate or br'; break;
            default: error = 'Bad request body';
        }
        if (logger) logger.warn({ requestId: req.requestId, status, type: err.type }, 'Rejected request body');
        return res.status(status).json({ error, request_id: req.requestId });
    };
}

// Last resort for anything a route or middleware throws that nothing else
// answered, so the JSON error contract has no hole. The detail goes to the log.
function finalErrorHandler({ logger }) {
    return (err, req, res, next) => {
        if (res.headersSent) return next(err);
        if (logger) logger.error({ err, requestId: req.requestId }, 'Unhandled error');
        return res.status(500).json({ error: 'Internal server error', request_id: req.requestId });
    };
}

module.exports = { bodyErrorHandler, finalErrorHandler };
