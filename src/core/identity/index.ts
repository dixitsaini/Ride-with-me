export type AuthenticatedIdentity = {
  userId: string;
};

export type IdentityService = {
  getIdentity: () => Promise<AuthenticatedIdentity>;
};
