import type { CSSProperties } from "react";
import { ROLES, deptColor, descendantCount, kids, type OrgIndex, type Person } from "../lib/org";

interface Props {
  index: OrgIndex;
  collapsed: Set<string>;
  selectedId: string | null;
  query: string;
  onSelect: (id: string) => void;
  onAdd: (managerId: string) => void;
  onToggle: (id: string) => void;
  canEdit: boolean;
}

const dc = (p: Person) => ({ "--dc": deptColor(p.dept) }) as CSSProperties;

export function matches(p: Person, query: string): boolean {
  if (!query) return false;
  const q = query.toLowerCase();
  return [p.name, p.title, p.dept].some((v) => v.toLowerCase().includes(q));
}

export function OrgTree(props: Props) {
  const roots = kids(props.index, null);
  return (
    <ul>
      {roots.map((p) => (
        <Node key={p.id} person={p} {...props} />
      ))}
    </ul>
  );
}

function Node({ person: p, ...props }: Props & { person: Person }) {
  const { index, collapsed, selectedId, query, onSelect, onAdd, onToggle, canEdit } = props;
  const children = kids(index, p.id);
  const isCollapsed = collapsed.has(p.id) && !query;
  const allLeaves = children.every((c) => kids(index, c.id).length === 0);

  const cls = ["card", p.role, p.id === selectedId && "selected", matches(p, query) && "hit"]
    .filter(Boolean)
    .join(" ");

  return (
    <li>
      <div className={"node" + (children.length ? " has-fold" : "")}>
        <div
          className={cls}
          style={dc(p)}
          role="button"
          tabIndex={0}
          aria-label={`${p.name}, ${p.title}`}
          onClick={() => onSelect(p.id)}
          onKeyDown={(e) => {
            if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              onSelect(p.id);
            }
          }}
        >
          <div className="dept">
            <i />
            {p.dept || "Без підрозділу"}
          </div>
          <div className="name">{p.name}</div>
          {p.title && <div className="title">{p.title}</div>}
          <span className="badge">{ROLES[p.role].label}</span>
          {canEdit && (
          <button
            className="add"
            type="button"
            title="Додати підлеглого"
            aria-label={`Додати підлеглого для ${p.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onAdd(p.id);
            }}
          >
            +
          </button>
          )}
        </div>
        {children.length > 0 && (
          <button
            className="fold"
            type="button"
            aria-label={isCollapsed ? "Розгорнути" : "Згорнути"}
            onClick={() => onToggle(p.id)}
          >
            {isCollapsed ? "+" : "−"} {descendantCount(index, p.id)}
          </button>
        )}
      </div>

      {children.length > 0 && !isCollapsed &&
        (allLeaves && children.length >= 3 ? (
          <ul>
            <li>
              <div className="stack">
                {children.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={
                      "mini" + (c.id === selectedId ? " selected" : "") + (matches(c, query) ? " hit" : "")
                    }
                    style={dc(c)}
                    onClick={() => onSelect(c.id)}
                  >
                    <i />
                    <span>
                      <b>{c.name}</b>
                      <small>{c.title || ROLES[c.role].label}</small>
                    </span>
                  </button>
                ))}
              </div>
            </li>
          </ul>
        ) : (
          <ul>
            {children.map((c) => (
              <Node key={c.id} person={c} {...props} />
            ))}
          </ul>
        ))}
    </li>
  );
}
