import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  let tempDocxPath = "";
  let tempDocPath = "";

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // 1. Write uploaded DOCX to temporary system path
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const tempDir = os.tmpdir();

    tempDocxPath = path.join(tempDir, `${fileId}.docx`);
    tempDocPath = path.join(tempDir, `${fileId}.doc`);

    await fs.writeFile(tempDocxPath, fileBuffer);

    // Escape backslashes for PowerShell single quotes
    const safeDocxPath = tempDocxPath.replace(/\\/g, "\\\\");
    const safeDocPath = tempDocPath.replace(/\\/g, "\\\\");

    // 2. Headless Word conversion to DOC (SaveFormat 0 = wdFormatDocument)
    const psScript = `
      $word = $null;
      $doc = $null;
      try {
        $word = New-Object -ComObject Word.Application;
        $word.Visible = $false;
        $word.DisplayAlerts = [Microsoft.Office.Interop.Word.WdAlertLevel]::wdAlertsNone;
        $doc = $word.Documents.Open('${safeDocxPath}');
        $doc.SaveAs([ref]'${safeDocPath}', [ref]0);
      } finally {
        if ($doc -ne $null) {
          $doc.Close([Microsoft.Office.Interop.Word.WdSaveOptions]::wdDoNotSaveChanges);
          [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null;
        }
        if ($word -ne $null) {
          $word.Quit();
          [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null;
        }
        [System.GC]::Collect();
        [System.GC]::WaitForPendingFinalizers();
      }
    `.replace(/\r?\n|\r/g, " ");

    // 60-second timeout to kill hanging Word background tasks
    await execAsync(`powershell -NoProfile -NonInteractive -Command "${psScript}"`, {
      timeout: 60000,
    });

    // 3. Read converted DOC bytes into memory
    const docBytes = await fs.readFile(tempDocPath);
    const baseName = path.parse(file.name).name;
    const finalFileName = `${baseName}.doc`;

    // 4. Return file directly to browser for download
    return new NextResponse(docBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/msword",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(finalFileName)}"`,
      },
    });
  } catch (error: any) {
    console.error("Native Word Conversion Error (DOC):", error);
    return NextResponse.json(
      { error: error.message || "Failed to convert DOCX to DOC" },
      { status: 500 }
    );
  } finally {
    // 5. Clean up temporary files
    if (tempDocxPath) await fs.unlink(tempDocxPath).catch(() => {});
    if (tempDocPath) await fs.unlink(tempDocPath).catch(() => {});
  }
}