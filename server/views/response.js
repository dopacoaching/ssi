const ok      = (res, data, message = 'Success') => res.status(200).json({ success: true, message, data });
const created  = (res, data, message = 'Created') => res.status(201).json({ success: true, message, data });
const badRequest = (res, message = 'Bad request') => res.status(400).json({ success: false, message });
const unauthorized = (res, message = 'Unauthorized') => res.status(401).json({ success: false, message });
const forbidden  = (res, message = 'Forbidden') => res.status(403).json({ success: false, message });
const notFound  = (res, message = 'Not found') => res.status(404).json({ success: false, message });

module.exports = { ok, created, badRequest, unauthorized, forbidden, notFound };
