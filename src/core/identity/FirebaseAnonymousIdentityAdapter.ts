import { getAuth, signInAnonymously, type Auth } from "firebase/auth";
import { getFirebaseApp } from "../firebase/config";
import type { AuthenticatedIdentity, IdentityService } from "./index";

export class FirebaseAnonymousIdentityAdapter implements IdentityService {
  private readonly auth: Auth;

  constructor(auth: Auth = getAuth(getFirebaseApp())) {
    this.auth = auth;
  }

  async getIdentity(): Promise<AuthenticatedIdentity> {
    const currentUser =
      this.auth.currentUser ?? (await signInAnonymously(this.auth)).user;
    return { userId: currentUser.uid };
  }
}
