const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const rm = (n) =>
  Number(n).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function documentHTML(q) {
  const { input, calculation: c } = q;
  let section = "";
  const rows = c.items
    .filter((i) => !i.hidden)
    .map((i) => {
      let heading = "";
      if (section !== i.section_code) {
        section = i.section_code;
        heading = `<tr class="section"><td colspan="2">${escape(i.section_name)}</td></tr>`;
      }
      return `${heading}<tr><td>${escape(i.description)}${i.sst_applicable ? " *" : ""}</td><td class="amount">${rm(i.amount)}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(q.number)}</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>@page{size:A4;margin:18mm}body{font:12px Arial;color:#191919}h1{font-size:20px}h2{font-size:17px}p{white-space:pre-line;line-height:1.5}table{width:100%;border-collapse:collapse}td{padding:6px 3px;border-bottom:1px solid #eee}.amount{text-align:right;white-space:nowrap}.section{font-weight:bold;background:#f3f3f3}thead{display:table-header-group}tr{break-inside:avoid}.total{font-size:16px;font-weight:bold}footer{font-size:10px;margin-top:25px;white-space:pre-line}</style></head><body><h1>CHAI & ASSOCIATES</h1><p>${escape((c.layout.company_lines || []).join("\n"))}</p><h2>${escape(c.layout.document_title || "PROFORMA")}</h2><p>Quotation: ${escape(input.ref_code || q.number)} · ${escape(input.quotation_date)}\nClient: ${escape(input.client_name)}\nPIC: ${escape(input.pic)}\nReference: ${escape(input.reference)}\n${escape(c.template_snapshot.name)} · Version ${c.template_snapshot.version}</p><table><thead><tr><th align="left">Description</th><th align="right">Amount (RM)</th></tr></thead><tbody>${rows}<tr><td>Professional fees</td><td class="amount">${rm(c.summary.professional_fees)}</td></tr><tr><td>Disbursements</td><td class="amount">${rm(c.summary.disbursements)}</td></tr><tr><td>SST (* taxable items)</td><td class="amount">${rm(c.summary.sst)}</td></tr><tr class="total"><td>Total payable</td><td class="amount">${rm(c.summary.total_payable)}</td></tr></tbody></table><p>Loan / property amount: RM ${rm(input.loan_amount)}\nTotal financing: RM ${rm(c.summary.total_financing)}</p><footer>${escape(c.layout.footer_note)}\n${escape((c.layout.payment_lines || []).join("\n"))}</footer></body></html>`;
}
export function csv(q) {
  const cell = (v) =>
    `"${String(v ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  const rows = [
    ["Quotation", q.input.ref_code || q.number],
    ["Client", q.input.client_name],
    ["Date", q.input.quotation_date],
    ["Section", "Description", "Amount (RM)", "SST applicable"],
    ...q.calculation.items
      .filter((i) => !i.hidden)
      .map((i) => [
        i.section_name,
        i.description,
        i.amount,
        i.sst_applicable ? "Yes" : "No",
      ]),
    ...Object.entries(q.calculation.summary).map(([k, v]) => [k, "", v]),
  ];
  return "\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

export async function xlsx(q) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "Chai & Associates";
  book.title = q.number;
  const sheet = book.addWorksheet("Proforma", {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  sheet.columns = [{ width: 72 }, { width: 20 }, { width: 16 }];
  const heading = (text, size = 12) => {
    const r = sheet.addRow([text]);
    sheet.mergeCells(r.number, 1, r.number, 3);
    r.font = { name: "Arial", size, bold: true };
    r.height = size + 14;
    return r;
  };
  heading("CHAI & ASSOCIATES", 18);
  for (const line of q.calculation.layout.company_lines || [])
    heading(line, 10);
  heading(q.calculation.layout.document_title || "PROFORMA", 15);
  for (const [label, value] of [
    ["Quotation", q.input.ref_code || q.number],
    ["Client", q.input.client_name],
    ["PIC", q.input.pic],
    ["Reference", q.input.reference],
    ["Date", q.input.quotation_date],
  ]) {
    const r = sheet.addRow([`${label}: ${value || ""}`]);
    sheet.mergeCells(r.number, 1, r.number, 3);
    r.alignment = { wrapText: true, vertical: "middle" };
    r.height = Math.max(22, Math.ceil(String(value || "").length / 80) * 15);
  }
  const headers = sheet.addRow([
    "Description",
    "Amount (RM)",
    "SST applicable",
  ]);
  headers.font = { bold: true };
  sheet.pageSetup.printTitlesRow = `${headers.number}:${headers.number}`;
  let section = "";
  for (const i of q.calculation.items.filter((i) => !i.hidden)) {
    if (section !== i.section_code) {
      section = i.section_code;
      const r = heading(i.section_name);
      r.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF2F2F2" },
      };
    }
    const r = sheet.addRow([
      i.description,
      i.amount,
      i.sst_applicable ? "Yes" : "No",
    ]);
    r.getCell(2).numFmt = "#,##0.00";
    r.alignment = { wrapText: true, vertical: "middle" };
    r.height = Math.max(22, Math.ceil(i.description.length / 65) * 16);
  }
  for (const [label, key] of [
    ["Professional fees", "professional_fees"],
    ["Disbursements", "disbursements"],
    ["SST", "sst"],
    ["Total payable", "total_payable"],
    ["Total financing", "total_financing"],
  ]) {
    const r = sheet.addRow([label, q.calculation.summary[key]]);
    r.font = { bold: true };
    r.getCell(2).numFmt = "#,##0.00";
    r.height = 26;
  }
  for (const line of [
    q.calculation.layout.footer_note,
    ...(q.calculation.layout.payment_lines || []),
  ].filter(Boolean)) {
    const r = sheet.addRow([line]);
    sheet.mergeCells(r.number, 1, r.number, 3);
    r.alignment = { wrapText: true };
    r.font = { size: 10 };
    r.height = Math.max(22, Math.ceil(line.length / 100) * 16);
  }
  sheet.eachRow((row) =>
    row.eachCell((cell) => {
      cell.font = { name: "Arial", size: 11, ...cell.font };
    }),
  );
  return Buffer.from(await book.xlsx.writeBuffer());
}
