import { Drawer, Alert, Spin, Typography } from 'antd';
import type { CSSProperties } from 'react';
import { Fragment, type ReactNode } from 'react';

export type TechnicalRecordFieldValue = unknown;

export type TechnicalRecordField = {
  label: string;
  value: TechnicalRecordFieldValue;
  copy?: boolean;
  compact?: boolean;
};

export type TechnicalRecordSection = {
  title: string;
  fields: TechnicalRecordField[];
};

export type TechnicalRecordTopField = {
  label: string;
  value: ReactNode;
};

type TechnicalRecordDrawerProps = {
  error?: unknown;
  loading?: boolean;
  onClose: () => void;
  open: boolean;
  sections?: TechnicalRecordSection[];
  title: string;
  top?: TechnicalRecordTopField[];
};

const defaultEmptyValue = '—';

const valueOverflowStyle: CSSProperties = {
  color: 'var(--text)',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
};

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    ['string', 'number', 'boolean'].includes(typeof value) ||
    value instanceof Date
  );
}

function isFlatObject(value: Record<string, unknown>) {
  return Object.entries(value).every(([, item]) =>
    item === null || ['string', 'number', 'boolean'].includes(typeof item) || item instanceof Date,
  );
}

function formatFieldLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((piece, index) => {
      const lowered = piece.toLowerCase();
      if (lowered === 'id') return 'ID';
      if (index === 0) return piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase();
      return lowered;
    })
    .join(' ');
}

function renderPrimitive(value: string | number | boolean | Date | null, copy: boolean) {
  const display = value === null ? defaultEmptyValue : String(value);
  if (display === defaultEmptyValue) {
    return (
      <Typography.Text type="secondary" style={valueOverflowStyle}>
        {defaultEmptyValue}
      </Typography.Text>
    );
  }

  return copy ? (
    <Typography.Text copyable={{ text: display }} style={valueOverflowStyle}>
      {display}
    </Typography.Text>
  ) : (
    <Typography.Text style={valueOverflowStyle}>{display}</Typography.Text>
  );
}

function renderCompactObjectValue(value: Record<string, unknown>) {
  return (
    <div className="technical-record-fields">
      {Object.entries(value).map(([field, nested]) => (
        <div className="technical-record-field" key={field}>
          <Typography.Text type="secondary" className="technical-record-label">
            {formatFieldLabel(field)}:
          </Typography.Text>
          <div className="technical-record-cell-value">{renderFieldValue(nested)}</div>
        </div>
      ))}
    </div>
  );
}

function renderStructuredValue(value: unknown, copy = false) {
  if (value === null || value === undefined) {
    return renderPrimitive(null, false);
  }
  if (value instanceof Date) return renderPrimitive(value, copy);
  if (isPrimitive(value)) return renderPrimitive(value, copy);
  if (Array.isArray(value)) {
    if (value.length === 0) return renderPrimitive(null, false);
    if (value.every((item) => isPrimitive(item) || item === undefined)) {
      return (
        <div className="technical-record-list">
          {value.map((item, index) => (
            <div className="technical-record-list-item" key={`${item}-${index}`}>
              {renderStructuredValue(item, false)}
            </div>
          ))}
        </div>
      );
    }
    return <pre className="safe-json-view">{JSON.stringify(value, null, 2)}</pre>;
  }
  if (typeof value === 'object') {
    if (isFlatObject(value as Record<string, unknown>)) {
      return renderCompactObjectValue(value as Record<string, unknown>);
    }
    return <pre className="safe-json-view">{JSON.stringify(value, null, 2)}</pre>;
  }
  return renderPrimitive(String(value), copy);
}

function renderFieldValue(value: unknown, copy = true) {
  return renderStructuredValue(value, copy);
}

function renderFieldRows(field: TechnicalRecordField) {
  const value = renderFieldValue(field.value, field.copy ?? (typeof field.value === 'string'));
  return (
    <div className="technical-record-row" key={field.label}>
      <Typography.Text type="secondary" className="technical-record-label">
        {field.label}
      </Typography.Text>
      <div className={`technical-record-cell-value ${field.compact ? 'is-compact' : ''}`}>
        {value}
      </div>
    </div>
  );
}

export function TechnicalRecordDrawer({
  error,
  loading,
  onClose,
  open,
  sections,
  title,
  top,
}: TechnicalRecordDrawerProps) {
  const hasData = (sections ?? []).some((section) => section.fields.length > 0);
  return (
    <Drawer
      className="technical-record-drawer"
      onClose={onClose}
      open={open}
      title={title}
      width="100%"
      destroyOnClose
    >
      {loading ? (
        <Spin />
      ) : error ? (
        <Alert message="Unable to load record details" showIcon type="error" />
      ) : (
        <>
          {top ? (
            <div className="technical-record-top">
              {top.map((item) => (
                <div className="technical-record-top-cell" key={item.label}>
                  <Typography.Text type="secondary">{item.label}</Typography.Text>
                  <div style={valueOverflowStyle}>{item.value}</div>
                </div>
              ))}
            </div>
          ) : null}

          {!hasData && !top ? (
            <Alert
              description="No additional technical data is available for this record yet."
              message="Record details"
              showIcon
              type="info"
            />
          ) : null}

          {(sections ?? []).map((section) => (
            <Fragment key={section.title}>
              {section.fields.length > 0 ? (
                <div className="technical-record-section">
                  <Typography.Title level={5}>{section.title}</Typography.Title>
                  <div className="technical-record-fields">
                    {section.fields.map(renderFieldRows)}
                  </div>
                </div>
              ) : null}
            </Fragment>
          ))}
        </>
      )}
    </Drawer>
  );
}
