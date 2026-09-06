const displayTimeZone = 'Asia/Kuala_Lumpur';

export function formatDate(value?: string | Date | null): string {
    if (!value) return '—';

    const normalized =
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? `${value}T00:00:00+08:00`
            : value;
    const date = normalized instanceof Date ? normalized : new Date(normalized);

    if (Number.isNaN(date.getTime())) return String(value);

    return new Intl.DateTimeFormat('en-GB', {
        timeZone: displayTimeZone,
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(date);
}

export function formatDateTime(value?: string | Date | null): string {
    if (!value) return '—';

    const normalized =
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? `${value}T00:00:00+08:00`
            : value;
    const date = normalized instanceof Date ? normalized : new Date(normalized);

    if (Number.isNaN(date.getTime())) return String(value);

    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: displayTimeZone,
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((item) => item.type === type)?.value ?? '';

    return `${part('day')} ${part('month')} ${part('year')} ${part('hour')}:${part('minute')} ${part('dayPeriod').toUpperCase()}`;
}
