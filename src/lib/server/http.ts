import { NextResponse } from "next/server";

export function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function internalError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  return NextResponse.json({ error: message }, { status: 500 });
}
