import { Drawer, Alert, Grid, Spin, Typography } from 'antd';
import type { CSSProperties } from 'react';
import { Fragment, isValidElement, type ReactNode } from 'react';

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

function canRenderAsCompactObject(
  value: unknown,
  depth = 0,
  maxDepth = 2,
): value is Record<string, unknown> {
  if (isValidElement(value) || value === undefined || typeof value === 'function') return false;
  if (value === null || isPrimitive(value) || value instanceof Date) return true;

  if (Array.isArray(value)) {
    return (
      depth < maxDepth &&
      value.length <= 12 &&
      value.every((item) => canRenderAsCompactObject(item, depth + 1, maxDepth))
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 12 || depth >= maxDepth) return false;
    return entries.every(([, item]) => canRenderAsCompactObject(item, depth + 1, maxDepth));
  }

  return false;
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

function renderPrimitive(value: string | number | boolean | Date | null) {
  const display = value === null ? defaultEmptyValue : String(value);
  if (display === defaultEmptyValue) {
    return (
      <Typography.Text type="secondary" style={valueOverflowStyle}>
        {defaultEmptyValue}
      </Typography.Text>
    );
  }

  return <Typography.Text style={valueOverflowStyle}>{display}</Typography.Text>;
}

function renderCompactObjectValue(value: Record<string, unknown>) {
  return (
    <div className="technical-record-fields technical-record-fields--nested">
      {Object.entries(value).map(([field, nested]) => (
        <div className="technical-record-row" key={field}>
          <Typography.Text type="secondary" className="technical-record-label">
            {formatFieldLabel(field)}
          </Typography.Text>
          <div className="technical-record-cell-value">{renderFieldValue(nested)}</div>
        </div>
      ))}
    </div>
  );
}

function renderStructuredValue(value: unknown) {
  if (isValidElement(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return renderPrimitive(null);
  }
  if (value instanceof Date) return renderPrimitive(value);
  if (isPrimitive(value)) return renderPrimitive(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return renderPrimitive(null);
    if (value.every((item) => isPrimitive(item) || item === undefined)) {
      return (
        <div className="technical-record-list">
          {value.map((item, index) => (
            <div className="technical-record-list-item" key={`${item}-${index}`}>
              {renderStructuredValue(item)}
            </div>
          ))}
        </div>
      );
    }
    return <pre className="safe-json-view">{JSON.stringify(value, null, 2)}</pre>;
  }
  if (typeof value === 'object') {
    if (canRenderAsCompactObject(value)) {
      return renderCompactObjectValue(value as Record<string, unknown>);
    }
    return <pre className="safe-json-view">{JSON.stringify(value, null, 2)}</pre>;
  }
  return renderPrimitive(String(value));
}

function renderFieldValue(value: unknown) {
  return renderStructuredValue(value);
}

function renderFieldRows(field: TechnicalRecordField) {
  const value = renderFieldValue(field.value);
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
  const screens = Grid.useBreakpoint();
  const isMobile = screens.lg === false;
  const width = isMobile ? '100%' : 560;
  const hasData = (sections ?? []).some((section) => section.fields.length > 0);
  return (
    <Drawer
      className="technical-record-drawer"
      onClose={onClose}
      open={open}
      title={title}
      width={width}
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
                  <Typography.Text type="secondary" className="technical-record-top-label">
                    {item.label}
                  </Typography.Text>
                  <div className="technical-record-top-value" style={valueOverflowStyle}>
                    {item.value}
                  </div>
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
                  <Typography.Title className="technical-record-section-title" level={5}>
                    {section.title}
                  </Typography.Title>
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
