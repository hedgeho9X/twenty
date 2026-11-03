/** Edits one document while keeping runtime context placeholders as immutable inline atoms. */
import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension, Node } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Plugin } from '@tiptap/pm/state';
import type { Node as ProseNode } from '@tiptap/pm/model';
const tokens = (doc: ProseNode) => {
  const keys: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'templateField') keys.push(node.attrs.field);
  });
  return JSON.stringify(keys);
};
export const BriefTemplateEditor = ({
  value,
  fields,
  disabled,
  onChange,
}: {
  value: string;
  fields: Record<string, { label: string; value: unknown }>;
  disabled: boolean;
  onChange: (value: string) => void;
}) => {
  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      Node.create({
        name: 'templateField',
        group: 'inline',
        inline: true,
        atom: true,
        selectable: false,
        addAttributes: () => ({ field: { default: '' } }),
        renderHTML: ({ node }) => [
          'code',
          {
            contenteditable: 'false',
            title: JSON.stringify(fields[node.attrs.field]?.value, null, 2),
            style:
              'font:inherit;padding:1px 4px;border-radius:4px;background:rgba(127,127,127,.13);cursor:help',
          },
          fields[node.attrs.field]?.label ?? node.attrs.field,
        ],
        renderText: ({ node }) => '${' + node.attrs.field + '}',
      }),
      Extension.create({
        name: 'protectTemplateFields',
        addProseMirrorPlugins: () => [
          new Plugin({
            filterTransaction: (tr, state) =>
              !tr.docChanged || tokens(tr.doc) === tokens(state.doc),
          }),
        ],
      }),
    ],
    content: {
      type: 'doc',
      content: value.split('\n').map((line) => ({
        type: 'paragraph',
        content: line
          .split(
            /(\$\{(?:candidateInfo|jobInfo|companyInfo|recommendations|jobPageUrl)\})/g,
          )
          .filter(Boolean)
          .map((part) => {
            const key = part.match(/^\$\{(.+)\}$/)?.[1];
            return key
              ? { type: 'templateField', attrs: { field: key } }
              : { type: 'text', text: part };
          }),
      })),
    },
    onUpdate: ({ editor }) =>
      onChange(editor.getText({ blockSeparator: '\n' })),
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': '模板文档',
        'aria-multiline': 'true',
        style:
          'min-height:360px;padding:16px;outline:none;white-space:pre-wrap;line-height:1.7;',
      },
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8 }}>
      <EditorContent editor={editor} />
    </div>
  );
};
