import type { CSSProperties } from 'react';

import type { ScenarioGraph } from './automation-api';
import { automationNodeLabel } from './automation-studio';

export function AutomationGraphPreview({
  compact = false,
  graph,
}: {
  compact?: boolean;
  graph: ScenarioGraph;
}) {
  const width = compact ? 126 : 720;
  const height = compact ? 64 : 380;
  const nodeWidth = compact ? 38 : 132;
  const nodeHeight = compact ? 13 : 44;
  const padding = compact ? 7 : 28;
  const positioned = graph.nodes.map((node, index) => ({
    ...node,
    position: node.position ?? { x: (index % 3) * 260, y: Math.floor(index / 3) * 150 },
  }));
  const minimumX = Math.min(...positioned.map((node) => node.position.x), 0);
  const minimumY = Math.min(...positioned.map((node) => node.position.y), 0);
  const maximumX = Math.max(...positioned.map((node) => node.position.x), 1);
  const maximumY = Math.max(...positioned.map((node) => node.position.y), 1);
  const scale = Math.min(
    (width - padding * 2 - nodeWidth) / Math.max(1, maximumX - minimumX),
    (height - padding * 2 - nodeHeight) / Math.max(1, maximumY - minimumY),
    compact ? 0.58 : 1.2,
  );
  const placement = new Map(
    positioned.map((node) => [
      node.id,
      {
        left: padding + (node.position.x - minimumX) * scale,
        top: padding + (node.position.y - minimumY) * scale,
      },
    ]),
  );

  return (
    <div
      aria-label="Version canvas preview"
      className={`automation-version-preview${compact ? ' is-compact' : ''}`}
      style={
        { '--preview-height': `${height}px`, '--preview-width': `${width}px` } as CSSProperties
      }
    >
      <svg aria-hidden="true" height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
        {graph.edges.map((edge, index) => {
          const source = placement.get(edge.from);
          const target = placement.get(edge.to);
          if (!source || !target) return null;
          return (
            <line
              key={edge.id ?? `${edge.from}-${edge.to}-${index}`}
              x1={source.left + nodeWidth / 2}
              x2={target.left + nodeWidth / 2}
              y1={source.top + nodeHeight}
              y2={target.top}
            />
          );
        })}
      </svg>
      {positioned.map((node) => {
        const point = placement.get(node.id)!;
        return (
          <span
            className={`automation-version-node automation-version-node--${node.type.toLowerCase()}`}
            key={node.id}
            style={{
              height: nodeHeight,
              left: point.left,
              top: point.top,
              width: nodeWidth,
            }}
            aria-label={automationNodeLabel(node.type)}
          >
            {compact ? null : automationNodeLabel(node.type)}
          </span>
        );
      })}
    </div>
  );
}
