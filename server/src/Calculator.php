<?php

declare(strict_types=1);

namespace Chai;

use RuntimeException;

final class Calculator
{
    public static function money(float|int $n): float
    {
        return round($n, 2);
    }

    public static function amount(mixed $n, string $label = 'Amount'): float
    {
        if (is_bool($n) || ! is_numeric($n) || ! is_finite((float) $n) || $n < 0 || $n > 1e12) {
            throw new RuntimeException("$label must be a non-negative number below 1 trillion.");
        }

        return (float) $n;
    }

    public static function evaluate(array $r, array $inputs, int $depth = 0): float
    {
        if ($depth > 15) {
            throw new RuntimeException('Rule nesting is too deep.');
        }
        $method = $r['method'] ?? 'fixed';
        $v = in_array($method, ['fixed', 'conditional']) ? 0 : self::amount($inputs[$r['basis'] ?? ''] ?? null, $r['basis'] ?? 'Basis');
        $num = fn ($key, $fallback = 0) => self::amount($r[$key] ?? $fallback, $key);
        $a = 0;
        switch ($method) {
            case 'fixed': $a = $num('amount');
                break;
            case 'percentage': $a = $v * $num('rate');
                break;
            case 'per_unit': $u = $num('unit_size', 1);
                if (! $u) {
                    throw new RuntimeException('Unit size must be positive.');
                } $a = ceil($v / $u) * $num('amount');
                break;
            case 'first_additional': $a = $v > 0 ? $num('amount') + max(0, ceil($v) - 1) * $num('additional_amount') : 0;
                break;
            case 'tiered':
                $lower = 0;
                $covered = false;
                foreach ($r['tiers'] ?? [] as $tier) {
                    $upper = $tier['up_to'] ?? INF;
                    if ($upper <= $lower) {
                        throw new RuntimeException('Tier limits must increase.');
                    }$a += max(0, min($v, $upper) - $lower) * self::amount($tier['rate'] ?? 0);
                    if ($v <= $upper) {
                        $covered = true;
                        break;
                    }$lower = $upper;
                }
                if (! $covered) {
                    throw new RuntimeException('The fee scale does not cover this amount. Add a negotiated tier to the template.');
                } break;
            case 'banded': $found = false;
                foreach ($r['bands'] ?? [] as $b) {
                    if (! isset($b['up_to']) || $v <= $b['up_to']) {
                        $a = self::amount($b['amount']);
                        $found = true;
                        break;
                    }
                }if (! $found) {
                    throw new RuntimeException('No fee band covers this amount.');
                }break;
            case 'conditional': $found = false;
                foreach ($r['cases'] ?? [] as $c) {
                    $match = true;
                    foreach ($c['when'] ?? [] as $k => $value) {
                        if (($inputs[$k] ?? null) !== $value) {
                            $match = false;
                        }
                    }if ($match) {
                        $a = self::evaluate($c['rule'], $inputs, $depth + 1);
                        $found = true;
                        break;
                    }
                }if (! $found) {
                    throw new RuntimeException('No rule matches these details.');
                }break;
            default:throw new RuntimeException('Unsupported calculation method.');
        }
        if (($r['zero_when_basis_zero'] ?? false) && $v == 0) {
            $a = 0;
        } else {
            if (isset($r['minimum'])) {
                $a = max($a, $num('minimum'));
            }if (isset($r['maximum'])) {
                $a = min($a, $num('maximum'));
            }
        }

        return self::money(self::amount($a));
    }

    private static function definitions(array $catalog): array
    {
        $d = [];
        foreach ($catalog as $s) {
            foreach ($s['conditions'] ?? [] as $c) {
                $d[$s['code'].'/'.$c['code']] = $c;
            }
        }

return $d;
    }

    private static function structured(array $rules, array $catalog, array $inputs): array
    {
        $defs = self::definitions($catalog);
        $pending = [];
        $resolved = [];
        foreach ($rules['sections'] as $section) {
            foreach ($section['items'] as $i) {
                if (isset($pending[$i['code']])) {
                    throw new RuntimeException('Template item identifiers must be unique.');
                }$pending[$i['code']] = array_replace(['section_code' => $section['code'], 'section_name' => $section['name'], 'category' => $section['category'], 'sort_order' => count($pending) * 10], $i);
            }
        }
        while ($pending) {
            $progress = false;
            foreach ($pending as $code => $i) {
                $context = array_replace($inputs, $i['input_defaults'] ?? []);
                $ready = true;
                foreach ($i['input_bindings'] ?? [] as $target => $binding) {
                    if (str_starts_with($binding, 'item:')) {
                        if (! isset($resolved[substr($binding, 5)])) {
                            $ready = false;
                            break;
                        }$context[$target] = $resolved[substr($binding, 5)]['amount'];
                    } else {
                        $context[$target] = $inputs[$binding] ?? null;
                    }
                }if (! $ready) {
                    continue;
                }
                $source = $i['source'] ?? 'fixed';
                $rule = $i['formula'] ?? $defs[$i['rule_ref'] ?? ''] ?? null;
                $a = match ($source) {
                    'rule' => $rule ? self::evaluate($rule, $context) : throw new RuntimeException('Missing rule for '.$i['description']),'manual' => $inputs[$i['input_key'] ?? $code] ?? $i['amount'] ?? 0,'fixed' => $i['amount'] ?? 0,default => throw new RuntimeException('Unsupported item source.')
                };
                $resolved[$code] = array_replace($i, ['amount' => self::money(self::amount($a)), 'source' => $source === 'rule' ? 'calculated' : $source, 'rule_snapshot' => $rule]);
                unset($pending[$code]);
                $progress = true;
            }if (! $progress) {
                throw new RuntimeException('Template contains missing or circular item references.');
            }
        }
        $result = array_values($resolved);
        usort($result, fn ($a, $b) => $a['sort_order'] <=> $b['sort_order']);

        return $result;
    }

    public static function calculate(array $t, array $input): array
    {
        $r = $t['rules'];
        $loan = self::money(self::amount($input['loan_amount'] ?? null, 'Loan amount'));
        $ccm = self::money(self::amount($input['ccm_search_amount'] ?? 0, 'CCM search'));
        $legal = ! empty($input['finance_legal_fee']) ? self::money(self::amount($input['legal_fee_financed_amount'] ?? null, 'Financed legal fee')) : 0;
        $insurance = ! empty($input['finance_insurance']) ? self::money(self::amount($input['insurance_financed_amount'] ?? null, 'Financed insurance')) : 0;
        $basis = self::money($loan + $legal);
        $items = [];
        if (isset($r['sections'])) {
            $items = self::structured($r, $t['catalog_sections'] ?? [], array_replace($input, ['loan_amount' => $loan, 'ccm_search_amount' => $ccm, 'loan_plus_financed_legal_fee' => $basis]));
        } else {
            $defs = self::definitions($t['catalog_sections'] ?? []);
            if (isset($defs['legal_transfer_non_hda/first_500k'])) {
                $c = $defs['legal_transfer_non_hda/first_500k'];
                $r['legal_fee']['first_500k_rate'] = $c['rate'];
                $r['legal_fee']['minimum'] = $c['minimum'];
            }
            if (isset($defs['legal_transfer_non_hda/next_7m'])) {
                $r['legal_fee']['next_7m_rate'] = $defs['legal_transfer_non_hda/next_7m']['rate'];
            }
            if (isset($defs['charge_documents/charge_fee'])) {
                $r['charge_fee'] = $defs['charge_documents/charge_fee'];
            }
            if (isset($defs['facility_stamp_duty/facility'])) {
                $r['facility_stamp_duty_rate'] = $defs['facility_stamp_duty/facility']['rate'];
            }
            $rate = 0;
            if ($loan > 7500000) {
                $rate = self::amount($input['negotiated_legal_fee_rate'] ?? null, 'Negotiated rate');
                if ($rate > 0.01) {
                    throw new RuntimeException('Negotiated rate cannot exceed 1%.');
                }
            }
            $fee = $loan ? self::money(max($r['legal_fee']['minimum'], min($loan, 500000) * $r['legal_fee']['first_500k_rate'] + min(max($loan - 500000, 0), 7000000) * $r['legal_fee']['next_7m_rate'] + max($loan - 7500000, 0) * $rate)) : 0;
            $add = function ($code, $description, $amount, $category, $sst = false, $source = 'fixed') use (&$items) {
                [$sc,$sn] = $category === 'professional' ? ['professional_fees', 'PROFESSIONAL FEES:-'] : (in_array($code, ['title_search', 'bankruptcy_search', 'ccm_search']) ? ['searches', 'Searches'] : (preg_match('/stamp|duplicate|letter_offer/', $code) ? ['stamp_duties', 'Stamp Duties (Subject to valuation)'] : (preg_match('/registration|form_19/', $code) ? ['registration_fees', 'Registration Fees (Subject to valuation)'] : ['others', 'Others'])));
                $items[] = ['code' => $code, 'description' => $description, 'amount' => self::money(self::amount($amount)), 'category' => $category, 'sst_applicable' => $sst, 'source' => $source, 'section_code' => $sc, 'section_name' => $sn, 'sort_order' => count($items) * 10];
            };
            $add('facilities_agreement', 'Facilities Agreement', $fee, 'professional', true, 'calculated');
            $add('charge', 'Form 16A and Charge Annexure', $loan ? min(max($fee * $r['charge_fee']['rate'], $r['charge_fee']['minimum']), $r['charge_fee']['maximum']) : 0, 'professional', true, 'calculated');
            foreach ($r['professional_fixed'] as $i) {
                $add($i['code'], $i['description'], $i['amount'], 'professional', (bool) ($i['sst'] ?? false));
            }
            foreach ($r['disbursements'] as $i) {
                $add($i['code'], $i['description'], $i['amount'], 'disbursement', (bool) ($i['sst'] ?? false));
            }
            $add('ccm_search', 'CCM Search', $ccm, 'disbursement', false, 'manual');
            $add('facility_stamp_duty', 'Facilities Agreement (Original)', $basis * $r['facility_stamp_duty_rate'], 'disbursement', false, 'calculated');
            $order = explode(',', 'facilities_agreement,charge,discharge,caveat_legal,statutory_declaration_legal,title_search,bankruptcy_search,ccm_search,facility_stamp_duty,facility_duplicate,charge_stamp,drr_stamp,form_16n_stamp,letter_offer,statutory_declaration_stamp,form_16a_registration,form_16n_registration,form_19b,form_19g,drr_filing,admin_bank,swearing,courier,printing,transportation,miscellaneous');
            $descriptions = ['charge_stamp' => 'Form 16A and Charge Annexure', 'form_16a_registration' => 'Form 16A and Charge Annexure', 'drr_stamp' => 'Deed of Receipt and Reassignment', 'form_16n_stamp' => 'Form 16N', 'form_16n_registration' => 'Form 16N', 'statutory_declaration_stamp' => 'Statutory Declaration', 'form_19g' => "Form 19G / Caveator's Consent"];
            foreach ($items as &$i) {
                $pos = array_search($i['code'], $order, true);
                $i['sort_order'] = ($pos === false ? 0 : $pos + 1) * 10;
                $i['description'] = $descriptions[$i['code']] ?? $i['description'];
            }unset($i);
        }
        foreach ($items as &$i) {
            $i['hidden'] = (bool) ($i['hidden'] ?? false);
            $i['sst_applicable'] = (bool) ($i['sst_applicable'] ?? false);
            $i['default_amount'] = $i['amount'];
            $i['default_description'] = $i['description'];
            $i['default_sst_applicable'] = $i['sst_applicable'];
            $i['amount_overridden'] = false;
        }unset($i);
        $seen = [];
        foreach ($input['line_overrides'] ?? [] as $o) {
            $code = $o['code'];
            if (isset($seen[$code])) {
                throw new RuntimeException('Duplicate quotation line.');
            }$seen[$code] = true;
            $index = array_search($code, array_column($items, 'code'), true);
            if ($index === false && ! str_starts_with($code, 'custom_')) {
                throw new RuntimeException('Unknown quotation line.');
            }
            $clean = ['description' => mb_substr((string) ($o['description'] ?? ''), 0, 255), 'hidden' => (bool) ($o['hidden'] ?? false), 'sst_applicable' => (bool) ($o['sst_applicable'] ?? false), 'sort_order' => self::amount($o['sort_order'] ?? 0)];
            if (! $clean['description']) {
                throw new RuntimeException('Line description is required.');
            }
            if ($index !== false) {
                $items[$index] = array_replace($items[$index], $clean);
                if (! empty($o['amount_overridden']) && ! in_array($code, ['facilities_agreement', 'charge', 'facility_stamp_duty'])) {
                    $items[$index]['amount'] = self::money(self::amount($o['amount']));
                    $items[$index]['amount_overridden'] = true;
                }
            } else {
                if (! in_array($o['category'], ['professional', 'disbursement'])) {
                    throw new RuntimeException('Invalid line category.');
                }$items[] = array_replace($clean, ['code' => $code, 'category' => $o['category'], 'section_code' => $o['section_code'] ?? 'custom', 'section_name' => $o['section_name'] ?? 'Additional items', 'source' => 'custom', 'amount' => self::money(self::amount($o['amount'])), 'amount_overridden' => true]);
            }
        }
        $order = array_flip(array_column($r['layout']['categories'] ?? [], 'code'));
        $key = fn ($i) => $order[$r['layout']['section_categories'][$i['section_code']] ?? $i['category']] ?? ($i['category'] === 'professional' ? 0 : 1);
        usort($items, fn ($a, $b) => ($key($a) <=> $key($b)) ?: ($a['sort_order'] <=> $b['sort_order']));
        $visible = array_filter($items, fn ($i) => ! $i['hidden']);
        $sum = fn ($a) => self::money(array_sum(array_column($a, 'amount')));
        $professional = $sum(array_filter($visible, fn ($i) => $i['category'] === 'professional'));
        $disb = $sum(array_filter($visible, fn ($i) => $i['category'] === 'disbursement'));
        $sstRate = self::amount($r['sst_rate']);
        if ($sstRate > 1) {
            throw new RuntimeException('SST rate must be between 0 and 1.');
        }$sst = self::money($sum(array_filter($visible, fn ($i) => $i['sst_applicable'])) * $sstRate);

        return ['calculation_formulas' => self::formulas($r, $items), 'rule_set' => array_intersect_key($t, array_flip(['id', 'name', 'version', 'code'])), 'items' => $items, 'layout' => $r['layout'] ?? new \stdClass, 'template_snapshot' => $t, 'inputs' => array_replace($input, ['loan_amount' => $loan]), 'summary' => ['professional_fees' => $professional, 'disbursements' => $disb, 'sst' => $sst, 'total_payable' => self::money($professional + $disb + $sst), 'stamp_duty_basis' => $basis, 'total_financing' => self::money($loan + $legal + $insurance)]];
    }

    public static function describe(array $r): string
    {
        $basis = $r['basis'] ?? '';
        $amount = $r['amount'] ?? 0;
        $rate = ($r['rate'] ?? 0) * 100;
        $limits = (isset($r['minimum']) ? '; minimum RM'.$r['minimum'] : '').(isset($r['maximum']) ? '; maximum RM'.$r['maximum'] : '');

        return match ($r['method'] ?? 'fixed') {
            'fixed' => "Fixed amount: RM$amount.",'percentage' => "$basis × $rate%$limits.",
            'tiered' => $basis.': '.implode('; ', array_map(fn ($t) => (isset($t['up_to']) ? 'up to RM'.$t['up_to'] : 'remaining amount').' at '.(($t['rate'] ?? 0) * 100).'%', $r['tiers'] ?? [])).$limits.'.',
            'per_unit' => "$basis ÷ ".($r['unit_size'] ?? 1).", rounded up × RM$amount.",
            'first_additional' => "First unit RM$amount; each additional unit RM".($r['additional_amount'] ?? 0).'.',
            'banded' => "Fee band selected using $basis.",'conditional' => 'Fee selected from the matching input conditions.',default => 'Structured fee rule.'
        };
    }

    private static function formulas(array $r, array $items): array
    {
        $out = [];
        if (isset($r['sections'])) {
            foreach ($items as $i) {
                if (! empty($i['rule_snapshot'])) {
                    $out[] = ['name' => $i['description'], 'formula' => self::describe($i['rule_snapshot'])];
                }
            }
        } else {
            $out = [['name' => 'Facilities Agreement', 'formula' => 'First RM500,000 × '.($r['legal_fee']['first_500k_rate'] * 100).'%; next RM7,000,000 × '.($r['legal_fee']['next_7m_rate'] * 100).'%. Excess above RM7.5m uses negotiated rate. Minimum RM'.$r['legal_fee']['minimum'].'; RM0 when loan is zero.'], ['name' => 'Form 16A and Charge Annexure', 'formula' => 'Facilities Agreement fee × '.($r['charge_fee']['rate'] * 100).'%; minimum RM'.$r['charge_fee']['minimum'].', maximum RM'.$r['charge_fee']['maximum'].'. RM0 when loan is zero.'], ['name' => 'Facilities Agreement stamp duty', 'formula' => '(Loan amount + financed legal fee) × '.($r['facility_stamp_duty_rate'] * 100).'%. Financed insurance is excluded.']];
        }

        return [...$out, ['name' => 'SST', 'formula' => 'Sum of visible taxable items × '.($r['sst_rate'] * 100).'%.'], ['name' => 'Total payable', 'formula' => 'Professional fees + disbursements + SST. Hidden items are excluded.'], ['name' => 'Total financing', 'formula' => 'Loan amount + financed legal fee + financed insurance. Only amounts selected for financing are included.']];
    }
}
