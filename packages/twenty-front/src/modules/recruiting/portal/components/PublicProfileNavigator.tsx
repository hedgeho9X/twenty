/** Presents shared profiles as one selectable list and one reading pane. */
import styled from '@emotion/styled';
import { THEME_LIGHT } from 'twenty-ui/theme';
import { type ReactNode, useState } from 'react';

const Layout = styled.div`
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  align-items: start;
  gap: 24px;
  @media (max-width: 700px) {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
`;
const List = styled.nav`
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: sticky;
  top: 24px;
  @media (max-width: 700px) {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    padding-bottom: 8px;
    > button {
      flex: 0 0 210px;
    }
  }
`;
const Choice = styled.button`
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 14px;
  text-align: left;
  &[aria-current='page'] {
    background: ${THEME_LIGHT.background.secondary};
    border-color: ${THEME_LIGHT.border.color.medium};
  }
  &:hover {
    background: ${THEME_LIGHT.background.secondary};
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

/** Changes only the visible profile, without loading another page or losing the list. */
export const PublicProfileNavigator = ({
  items,
}: {
  items: {
    key: string;
    title: string;
    subtitle?: string;
    content: ReactNode;
  }[];
}) => {
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, Math.max(0, items.length - 1));
  if (!items.length) return null;
  return (
    <Layout>
      <List aria-label="推荐资料列表">
        {items.map((item, i) => (
          <Choice
            key={item.key}
            type="button"
            aria-current={i === index ? 'page' : undefined}
            onClick={() => setSelected(i)}
          >
            <strong>{item.title}</strong>
            {item.subtitle && (
              <span style={{ display: 'block', fontSize: 13, marginTop: 6 }}>
                {item.subtitle}
              </span>
            )}
          </Choice>
        ))}
      </List>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <span>
            {index + 1} / {items.length}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Choice
              type="button"
              disabled={index === 0}
              onClick={() => setSelected(index - 1)}
            >
              ← 上一个
            </Choice>
            <Choice
              type="button"
              disabled={index === items.length - 1}
              onClick={() => setSelected(index + 1)}
            >
              下一个 →
            </Choice>
          </div>
        </div>
        <article key={items[index].key}>{items[index].content}</article>
      </div>
    </Layout>
  );
};
