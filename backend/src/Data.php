<?php

declare(strict_types=1);

namespace Chai;

use RuntimeException;

final class Data
{
    public string $directory;

    public function __construct(public Store $store, ?string $directory = null)
    {
        $this->directory = $directory ?? (getenv('DATA_DIR') ?: dirname(__DIR__).'/data');
        if (! is_dir($this->directory) && ! mkdir($this->directory, 0700, true)) {
            throw new RuntimeException('Cannot create backup directory.');
        }
    }

    private static function fail(string $m): never
    {
        throw new RuntimeException('Invalid backup: '.$m);
    }

    private static function text(mixed $v, int $max = 1000): bool
    {
        return is_string($v) && strlen($v) > 0 && mb_strlen($v) <= $max;
    }

    public static function validateTemplate(array $t): void
    {
        if (! self::text($t['id'] ?? null, 100) || ! self::text($t['code'] ?? null, 100) || ! self::text($t['name'] ?? null, 255) || ! is_int($t['version'] ?? null) || $t['version'] < 1 || ! is_array($t['rules'] ?? null)) {
            self::fail('malformed template.');
        }
        $r = $t['rules'];
        if (! isset($r['sst_rate']) || ! is_numeric($r['sst_rate']) || $r['sst_rate'] < 0 || $r['sst_rate'] > 1) {
            self::fail('invalid tax rate.');
        }
        if (! in_array($t['status'] ?? 'active', ['active', 'draft', 'superseded'])) {
            self::fail('invalid template status.');
        }
        if (isset($r['sections'])) {
            $codes = [];
            if (! is_array($r['sections'])) {
                self::fail('invalid sections.');
            }foreach ($r['sections'] as $s) {
                if (! self::text($s['code'] ?? null) || ! self::text($s['name'] ?? null) || ! in_array($s['category'] ?? '', ['professional', 'disbursement']) || ! is_array($s['items'] ?? null)) {
                    self::fail('invalid section.');
                }foreach ($s['items'] as $i) {
                    if (! self::text($i['code'] ?? null) || isset($codes[$i['code']]) || ! self::text($i['description'] ?? null) || ! in_array($i['source'] ?? '', ['fixed', 'manual', 'rule'])) {
                        self::fail('invalid fee line.');
                    }$codes[$i['code']] = true;
                }
            }
        } elseif (! isset($r['legal_fee'],$r['charge_fee'],$r['professional_fixed'],$r['disbursements'])) {
            self::fail('missing fee rules.');
        }
    }

    public static function validate(array $data): array
    {
        if (($data['format'] ?? '') !== 'chai-php-tools' || ($data['version'] ?? null) !== 1 || ! is_array($data['templates'] ?? null) || ! is_array($data['quotations'] ?? null)) {
            self::fail('unsupported backup format.');
        }
        if (count($data['templates']) > 10000 || count($data['quotations']) > 100000) {
            self::fail('too many records.');
        }$ids = [];
        $versions = [];
        foreach ($data['templates'] as $row) {
            if (! is_array($row) || ! self::text($row['body'] ?? null, 2000000) || ! self::text($row['created_at'] ?? null, 40)) {
                self::fail('invalid template row.');
            }$t = json_decode($row['body'], true, 128, JSON_THROW_ON_ERROR);
            if (! is_array($t)) {
                self::fail('invalid template body.');
            }self::validateTemplate($t);
            foreach (['id', 'code', 'name', 'version'] as $k) {
                if (($row[$k] ?? null) !== $t[$k]) {
                    self::fail('inconsistent template.');
                }
            }$key = $row['code'].'/'.$row['version'];
            if (isset($ids[$row['id']]) || isset($versions[$key])) {
                self::fail('duplicate template.');
            }$ids[$row['id']] = true;
            $versions[$key] = true;
        }
        $ids = [];
        $numbers = [];
        foreach ($data['quotations'] as $row) {
            foreach (['id' => 100, 'number' => 100, 'client_name' => 255, 'created_at' => 40, 'updated_at' => 40, 'body' => 4000000] as $k => $max) {
                if (! self::text($row[$k] ?? null, $max)) {
                    self::fail('invalid quotation row.');
                }
            }if (! is_int($row['revision'] ?? null) || $row['revision'] < 1 || ! in_array($row['status'] ?? '', ['draft', 'issued'])) {
                self::fail('invalid quotation revision or status.');
            }if (isset($ids[$row['id']]) || isset($numbers[$row['number']])) {
                self::fail('duplicate quotation.');
            }$ids[$row['id']] = true;
            $numbers[$row['number']] = true;
            $q = json_decode($row['body'], true, 128, JSON_THROW_ON_ERROR);
            if (! is_array($q) || ! self::text($q['input']['client_name'] ?? null, 255) || trim($q['input']['client_name']) !== $row['client_name'] || ($q['input']['status'] ?? null) !== $row['status'] || ! is_array($q['calculation']['items'] ?? null) || ! is_array($q['calculation']['template_snapshot'] ?? null)) {
                self::fail('inconsistent quotation data.');
            }self::validateTemplate($q['calculation']['template_snapshot']);
            foreach (['professional_fees', 'disbursements', 'sst', 'total_payable', 'stamp_duty_basis', 'total_financing'] as $k) {
                $n = $q['calculation']['summary'][$k] ?? null;
                if (! is_int($n) && ! is_float($n)) {
                    self::fail('invalid quotation total.');
                }Calculator::amount($n);
            }
            $codes = [];
            foreach ($q['calculation']['items'] as $i) {
                if (! self::text($i['code'] ?? null) || isset($codes[$i['code']]) || ! self::text($i['description'] ?? null)) {
                    self::fail('invalid quotation fee.');
                }Calculator::amount($i['amount'] ?? null);
                $codes[$i['code']] = true;
            }
        }

return $data;
    }

    public function snapshot(): array
    {
        return self::validate(['format' => 'chai-php-tools', 'version' => 1, 'exported_at' => Store::now(), 'templates' => $this->store->query('SELECT * FROM templates ORDER BY code,version')->fetchAll(), 'quotations' => $this->store->query('SELECT * FROM quotations ORDER BY created_at,id')->fetchAll()]);
    }

    public function restoreSnapshot(array $data): array
    {
        self::validate($data);

        return $this->store->transaction(function () use ($data) {
            $this->store->query('DELETE FROM quotations');
            $this->store->query('DELETE FROM templates');
            foreach ($data['templates'] as $row) {
                $this->store->query('INSERT INTO templates VALUES(?,?,?,?,?,?)', array_map(fn ($k) => $row[$k], ['id', 'code', 'name', 'version', 'body', 'created_at']));
            }
            foreach ($data['quotations'] as $row) {
                $this->store->query('INSERT INTO quotations VALUES(?,?,?,?,?,?,?,?)', array_map(fn ($k) => $row[$k], ['id', 'number', 'client_name', 'status', 'revision', 'body', 'created_at', 'updated_at']));
            }

            return ['templates' => count($data['templates']), 'quotations' => count($data['quotations'])];
        });
    }

    public function backups(): array
    {
        $out = [];
        foreach (glob($this->directory.'/chai-*.json') as $f) {
            if (! preg_match('/^chai-(auto|manual|before-restore)-[a-zA-Z0-9T.-]+\.json$/D', basename($f))) {
                continue;
            }$out[] = ['name' => basename($f), 'size' => filesize($f), 'created_at' => gmdate('c', filemtime($f)), 'kind' => str_starts_with(basename($f), 'chai-auto-') ? 'automatic' : (str_starts_with(basename($f), 'chai-manual-') ? 'manual' : 'safety')];
        }usort($out, fn ($a, $b) => strcmp($b['name'], $a['name']));
        usort($out, fn ($a, $b) => strcmp($b['created_at'], $a['created_at']));

        return $out;
    }

    public function backupPath(string $name): string
    {
        if (! in_array($name, array_column($this->backups(), 'name'), true)) {
            throw new RuntimeException('Backup not found.');
        }

return $this->directory.'/'.$name;
    }

    public function backup(string $kind = 'manual'): string
    {
        if (! in_array($kind, ['auto', 'manual', 'before-restore'])) {
            throw new RuntimeException('Invalid backup kind.');
        }$name = 'chai-'.$kind.'-'.gmdate('Y-m-d\TH-i-s').'-'.bin2hex(random_bytes(4)).'.json';
        $this->atomic($this->directory.'/'.$name, Store::json($this->snapshot()));

        return $name;
    }

    private function atomic(string $file, string $body): void
    {
        $tmp = $file.'.partial';
        try {
            if (file_put_contents($tmp, $body, LOCK_EX) !== strlen($body)) {
                throw new RuntimeException('Could not write backup. Check free disk space.');
            }chmod($tmp, 0600);
            if (! rename($tmp, $file)) {
                throw new RuntimeException('Could not finalize backup.');
            }
        } finally {
            if (is_file($tmp)) {
                unlink($tmp);
            }
        }
    }

    public function daily(): void
    {
        if (! $this->store->setting('autoBackup', true)) {
            return;
        }
        try {
            $date = gmdate('Y-m-d');
            $exists = false;
            foreach ($this->backups() as $b) {
                if (str_starts_with($b['name'], 'chai-auto-'.$date)) {
                    $exists = true;
                }
            }if (! $exists) {
                $this->backup('auto');
            }$auto = array_values(array_filter($this->backups(), fn ($b) => $b['kind'] === 'automatic'));
            foreach (array_slice($auto, 14) as $b) {
                unlink($this->backupPath($b['name']));
            }$this->store->setSetting('autoBackupError', null);
        } catch (\Throwable $e) {
            $this->store->setSetting('autoBackupError', 'Automatic backup failed. Check available disk space and backup permissions.');
            throw $e;
        }
    }

    public function settings(): array
    {
        return ['mode' => 'mysql', 'database' => 'MySQL / '.(getenv('DB_NAME') ?: 'chai'), 'autoBackup' => $this->store->setting('autoBackup', true), 'autoBackupError' => $this->store->setting('autoBackupError'), 'backups' => $this->backups(), 'counts' => ['quotations' => (int) $this->store->query('SELECT COUNT(*) FROM quotations')->fetchColumn(), 'templates' => (int) $this->store->query('SELECT COUNT(*) FROM templates')->fetchColumn()]];
    }

    public function fingerprint(): string
    {
        $d = $this->snapshot();
        unset($d['exported_at']);

        return hash('sha256', Store::json($d));
    }

    public function prepare(array $data, string $name): array
    {
        self::validate($data);
        $token = bin2hex(random_bytes(24));
        $this->atomic($this->directory.'/pending-'.$token.'.json', Store::json(['data' => $data, 'fingerprint' => $this->fingerprint(), 'expires' => time() + 1800]));
        foreach (glob($this->directory.'/pending-*.json') as $f) {
            if (filemtime($f) < time() - 1800) {
                unlink($f);
            }
        }

        return ['token' => $token, 'file' => basename($name), 'quotations' => count($data['quotations']), 'templates' => count($data['templates'])];
    }

    private function pendingPath(string $token): string
    {
        if (! preg_match('/^[a-f0-9]{48}$/D', $token)) {
            throw new RuntimeException('Invalid restore token.');
        }

return $this->directory.'/pending-'.$token.'.json';
    }

    public function cancel(string $token): bool
    {
        $f = $this->pendingPath($token);
        if (is_file($f)) {
            unlink($f);
        }

return true;
    }

    public function apply(string $token, string $mode): array
    {
        if (! in_array($mode, ['restore'])) {
            throw new RuntimeException('Invalid restore mode.');
        }$f = $this->pendingPath($token);
        if (! is_file($f)) {
            throw new RuntimeException('Restore preview expired. Select the backup again.');
        }$p = json_decode(file_get_contents($f), true, 128, JSON_THROW_ON_ERROR);
        if ($p['expires'] < time() || $p['fingerprint'] !== $this->fingerprint()) {
            throw new RuntimeException('Data changed or preview expired. Select the backup again.');
        }
        self::validate($p['data']);
        $safety = $this->backup('before-restore');
        $result = $this->restoreSnapshot($p['data']);
        unlink($f);

        return $result + ['safetyBackup' => $safety, 'settings' => $this->settings()];
    }
}
