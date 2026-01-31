declare global {
  namespace App {
    interface Locals {
      requestId: string;
    }
  }
}

export const __appLocals: unique symbol;
