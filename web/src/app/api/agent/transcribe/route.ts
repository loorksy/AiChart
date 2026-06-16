import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { transcribeAudio } from "@/lib/gemini";

export const maxDuration = 120;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

/**
 * Bridge: voice-note transcription. Accepts multipart
 * (`file` field) or JSON `{data: base64, mime}` and returns plain text.
 */
export async function POST(req: NextRequest) {
  try {
    requireAgentAuth(req);

    let buffer: Buffer | null = null;
    let mime = "audio/ogg";

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file instanceof File) {
        buffer = Buffer.from(await file.arrayBuffer());
        if (file.type) mime = file.type;
        else if (file.name.endsWith(".mp3")) mime = "audio/mpeg";
        else if (file.name.endsWith(".wav")) mime = "audio/wav";
        else if (file.name.endsWith(".m4a")) mime = "audio/mp4";
      }
    } else {
      const body = (await req.json().catch(() => ({}))) as {
        data?: string;
        mime?: string;
      };
      if (body.data) {
        buffer = Buffer.from(body.data, "base64");
        if (body.mime) mime = body.mime;
      }
    }

    if (!buffer || buffer.length < 256) {
      return NextResponse.json(
        { error: "أرسل ملفاً صوتياً (multipart حقل file أو JSON بحقل data)." },
        { status: 400 },
      );
    }
    if (buffer.length > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "الملف الصوتي أكبر من 20MB." },
        { status: 413 },
      );
    }

    const transcript = await transcribeAudio(buffer, mime);
    return new NextResponse(transcript, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    return handleError(e);
  }
}
