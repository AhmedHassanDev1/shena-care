/** The credentials were valid but the account holds no workspace role: the session is dropped at once. */
export class NotAuthorizedError extends Error {
  constructor() {
    super('This account is not authorised for the Business Workspace.')
    this.name = 'NotAuthorizedError'
  }
}
