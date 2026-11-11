import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  let tempDocxPath = "";
  let tempPdfPath = "";

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // 1. Write uploaded DOCX to a temporary OS path
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const tempDir = os.tmpdir();

    tempDocxPath = path.join(tempDir, `${fileId}.docx`);
    tempPdfPath = path.join(tempDir, `${fileId}.pdf`);

    await fs.writeFile(tempDocxPath, fileBuffer);

    // 2. Headless Word conversion via PowerShell
    const safeDocxPath = tempDocxPath.replace(/\\/g, "\\\\");
    const safePdfPath = tempPdfPath.replace(/\\/g, "\\\\");

    const psScript = `
      $word = $null;
      $doc = $null;
      try {
        $word = New-Object -ComObject Word.Application;
        $word.Visible = $false;
        $word.DisplayAlerts = [Microsoft.Office.Interop.Word.WdAlertLevel]::wdAlertsNone;
        $doc = $word.Documents.Open('${safeDocxPath}');
        $doc.ExportAsFixedFormat(
          '${safePdfPath}',
          17,
          $false,
          0,
          0,
          1,
          1,
          0,
          $true,
          $true,
          0,
          $true,
          $true,
          $false
        );
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

    await execAsync(`powershell -NoProfile -NonInteractive -Command "${psScript}"`, {
      timeout: 60000,
    });

    // 3. Read generated PDF into memory
    const pdfBytes = await fs.readFile(tempPdfPath);
    const baseName = path.parse(file.name).name;
    const finalFileName = `${baseName}.pdf`;

    // 4. Stream directly to client
    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(finalFileName)}"`,
      },
    });
  } catch (error: any) {
    console.error("Native Word Conversion Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to convert DOCX to PDF" },
      { status: 500 }
    );
  } finally {
    // 5. Clean up temporary files immediately
    if (tempDocxPath) await fs.unlink(tempDocxPath).catch(() => {});
    if (tempPdfPath) await fs.unlink(tempPdfPath).catch(() => {});
  }
}