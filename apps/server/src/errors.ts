export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
export const notFound = (what = "Not found") => new HttpError(404, "not_found", what);
export const forbidden = (msg = "You do not have permission to do that") => new HttpError(403, "forbidden", msg);
export const badRequest = (msg: string) => new HttpError(400, "bad_request", msg);
export const conflict = (msg: string) => new HttpError(409, "conflict", msg);
export const unauthorized = (msg = "Authentication required") => new HttpError(401, "unauthorized", msg);
