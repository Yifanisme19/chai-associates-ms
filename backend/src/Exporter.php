<?php

declare(strict_types=1);

namespace Chai;

use Dompdf\Dompdf;
use Dompdf\Options;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use setasign\Fpdi\Fpdi;
use setasign\Fpdi\PdfParser\StreamReader;

final class Exporter
{
    public static function html(array $q): string
    {
        return QuotationDocument::html($q);
    }

    public static function pdf(array $q): string
    {
        $options = new Options;
        $options->set('isRemoteEnabled', false);
        $options->set('isPhpEnabled', false);
        $options->set('chroot', __DIR__);
        $options->set('isFontSubsettingEnabled', true);
        $document = new Dompdf($options);
        // Render at a fixed document width first. Measure the real bottom, including
        // wrapped descriptions and the footer, before uniformly fitting it to A4.
        $pageWidth = 595.28;
        $pageHeight = 841.89;
        $margin = 28.35;
        $contentWidth = $pageWidth - 2 * $margin;
        $renderHeight = 14400.0;
        $endY = null;
        $document->setCallbacks([['event' => 'end_frame', 'f' => function ($frame) use (&$endY) {
            $node = $frame->get_node();
            if ($node instanceof \DOMElement && $node->getAttribute('id') === 'document-end') {
                $endY = (float) $frame->get_position('y') + (float) $frame->get_margin_height();
            }
        }]]);
        $document->loadHtml(self::html($q));
        $document->setPaper([0, 0, $contentWidth, $renderHeight]);
        $document->render();
        if ($endY === null) {
            throw new \RuntimeException('Could not measure the quotation PDF.');
        }
        $pdf = new Fpdi('P', 'pt', [$pageWidth, $pageHeight]);
        $pages = $pdf->setSourceFile(StreamReader::createByString($document->output()));
        $contentHeight = ($pages - 1) * $renderHeight + $endY + 2;
        $scale = min(1.0, ($pageHeight - 2 * $margin) / max(1, $contentHeight));
        $pdf->SetAutoPageBreak(false);
        $pdf->AddPage();
        $pdf->SetTitle((string) $q['number']);
        $pdf->SetCreator('Chai & Associates');
        for ($page = 1; $page <= $pages; $page++) {
            $template = $pdf->importPage($page);
            $pdf->useTemplate($template, $margin + ($contentWidth * (1 - $scale) / 2), $margin + ($page - 1) * $renderHeight * $scale, $contentWidth * $scale, $renderHeight * $scale);
        }

        return $pdf->Output('S');
    }

    public static function xlsx(array $q): string
    {
        $book = new Spreadsheet;
        $book->getProperties()->setCreator('Chai & Associates')->setTitle($q['number']);
        $sheet = $book->getActiveSheet();
        $sheet->setTitle('Proforma')->setShowGridlines(false);
        $sheet->getColumnDimension('A')->setWidth(72);
        $sheet->getColumnDimension('B')->setWidth(20);
        $sheet->getColumnDimension('C')->setWidth(16);
        $row = 1;
        $add = function (array $values, bool $bold = false, bool $merged = false, int $size = 11) use ($sheet, &$row) {
            $n = $row++;
            foreach ($values as $k => $value) {
                $sheet->setCellValueExplicit([$k + 1, $n], $value, is_int($value) || is_float($value) ? DataType::TYPE_NUMERIC : DataType::TYPE_STRING);
            }if ($merged) {
                $sheet->mergeCells("A$n:C$n");
            }$sheet->getStyle("A$n:C$n")->getFont()->setName('Arial')->setSize($size)->setBold($bold);
            $sheet->getStyle("A$n:C$n")->getAlignment()->setWrapText(true)->setVertical('center');
            $sheet->getRowDimension($n)->setRowHeight(max(24, ceil(mb_strlen((string) ($values[0] ?? '')) / ($merged ? 95 : 65)) * 16));

            return $n;
        };
        $c = $q['calculation'];
        $i = $q['input'];
        $add(['CHAI & ASSOCIATES'], true, true, 18);
        foreach ($c['layout']['company_lines'] ?? [] as $line) {
            $add([$line], true, true, 10);
        }$add([$c['layout']['document_title'] ?? 'PROFORMA'], true, true, 15);
        foreach (['Quotation' => $i['ref_code'] ?? $q['number'], 'Client' => $i['client_name'], 'PIC' => $i['pic'] ?? '', 'Reference' => $i['reference'] ?? '', 'Date' => $i['quotation_date']] as $label => $v) {
            $add(["$label: $v"], false, true);
        }
        $headers = $add(['Description', 'Amount (RM)', 'SST applicable'], true);
        $sheet->getPageSetup()->setRowsToRepeatAtTop([$headers, $headers]);
        $section = '';
        foreach ($c['items'] as $item) {
            if ($item['hidden']) {
                continue;
            }if ($section !== $item['section_code']) {
                $section = $item['section_code'];
                $n = $add([$item['section_name']], true, true);
                $sheet->getStyle("A$n:C$n")->getFill()->setFillType('solid')->getStartColor()->setARGB('FFF2F2F2');
            }$n = $add([$item['description'], (float) $item['amount'], $item['sst_applicable'] ? 'Yes' : 'No']);
            $sheet->getStyle("B$n")->getNumberFormat()->setFormatCode('#,##0.00');
        }
        foreach (['Professional fees' => 'professional_fees', 'Disbursements' => 'disbursements', 'SST' => 'sst', 'Total payable' => 'total_payable', 'Total financing' => 'total_financing'] as $label => $key) {
            $n = $add([$label, (float) $c['summary'][$key]], true);
            $sheet->getStyle("B$n")->getNumberFormat()->setFormatCode('#,##0.00');
        }
        foreach ([$c['layout']['footer_note'] ?? '', ...($c['layout']['payment_lines'] ?? [])] as $line) {
            if ($line) {
                $add([$line], false, true, 10);
            }
        }
        $sheet->getPageSetup()->setPaperSize(9)->setFitToWidth(1)->setFitToHeight(0);
        $tmp = tempnam(sys_get_temp_dir(), 'chai-xlsx-');
        try {
            (new Xlsx($book))->save($tmp);

            return file_get_contents($tmp);
        } finally {
            unlink($tmp);
            $book->disconnectWorksheets();
        }
    }
}
