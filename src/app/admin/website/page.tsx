import type { Metadata } from "next";
import { getWebsiteContent } from "@/server/data";
import WebsiteEditorClient from "@/components/website-editor-client";

export const metadata: Metadata = { title: "Website Editor" };

export default async function WebsiteEditorPage() {
  const content = await getWebsiteContent();

  return (
    <div className="p-4 sm:p-7 app-page app-page-mid [--page-w:1600px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl text-white">Website editor</h1>
          <p className="text-mist text-[12.5px] mt-1">Edit the public homepage copy without touching source code.</p>
        </div>
        <a href="/" target="_blank" className="text-[12.5px] rounded-xl px-4 py-2.5 border border-white/10 text-chrome hover:text-white hover:bg-white/5 transition">
          Preview website
        </a>
      </div>
      <WebsiteEditorClient initialContent={content} />
    </div>
  );
}
