import * as prettier from 'prettier';
import * as vscode from 'vscode';
import * as htmlPlugin from 'prettier/parser-html';

type ExtendedOptions = prettier.Options &
	Partial<{
		twigMelodyPlugins: string[];
		twigMultiTags: string[];
		twigSingleQuote: boolean;
		twigAlwaysBreakObjects: boolean;
		twigPrintWidth: number;
		twigFollowOfficialCodingStandards: boolean;
		twigOutputEndblockName: boolean;
	}>;

type FormattingError = Error & {
	loc: {
		start: {
			line: number;
			column: number;
		};
		end: {
			line: number;
			column: number;
		};
	};
};

type Node = {
	children: Node[];
	name: string;
	type: string;
	prev: Node;
	value: string;
	sourceSpan: {
		start: {
			line: number;
			col: number;
			offset: number;
		};
	};
};

function formatIndentation(
	options: prettier.Options,
	node: Node,
	doc: { text: string },
	incrChars: number,
	ctext: string,
	child: Node,
	incrLines: number,
	eol: string,
	indent: string
) {
	options.parser = node.name == 'script' ? 'babel' : 'css';

	const tagOffset = node.sourceSpan.start.offset;
	let tagOffset2 = tagOffset;
	while (tagOffset2 > -1) {
		if (doc.text[tagOffset2 + incrChars] == '\n') {
			break;
		}
		tagOffset2--;
	}
	const tagIndent = doc.text.slice(tagOffset2 + 1 + incrChars, tagOffset + incrChars).replace(/\S/g, ' ');

	ctext = '\n'.repeat(child.sourceSpan.start.line + incrLines) + ' '.repeat(child.sourceSpan.start.col) + child.value; //keep the line and column for error tips
	ctext =
		eol +
		prettier
			.format(ctext, options)
			.trim()
			.split(eol)
			.map((line) => tagIndent + indent + line)
			.join(eol) +
		eol +
		tagIndent;
	return ctext;
}

/**
 * Formats the `<style>` and `<script>` tags using their respective parsers
 */
function formatStyleAndScript(doc: { text: string }, options: prettier.Options) {
	let indent: string;
	if (options.useTabs) {
		indent = '\t';
	} else {
		indent = ' '.repeat(options.tabWidth ?? 2);
	}

	const eol = doc.text.includes('\r\n') ? '\r\n' : '\n';

	const result = htmlPlugin.parsers.html.parse(doc.text, {}, {} as prettier.ParserOptions);
	let incrChars = 0;
	let incrLines = 0;

	const doFormat = <T extends Node>(root: T) => {
		if (!root.children) return;
		for (const element of root.children) {
			const node = element;
			if (node.type == 'element' && (node.name == 'script' || node.name == 'style')) {
				if (node.children.length == 0) {
					continue;
				}

				if (node.prev && node.prev.value) {
					const prevNode = node.prev.value.trim();
					if (prevNode.endsWith('{# prettier-ignore #}') || prevNode.endsWith('{% comment %}')) {
						continue;
					}
				}

				const child = node.children[0];
				let ctext = child.value;
				if (ctext.trim()) {
					ctext = formatIndentation(options, node, doc, incrChars, ctext, child, incrLines, eol, indent);
				} else {
					ctext = '';
				}
				const start = child.sourceSpan.start.offset;

				doc.text =
					doc.text.slice(0, start + incrChars) +
					ctext +
					doc.text.slice(start + child.value.length + incrChars);
				incrChars += ctext.length - child.value.length;
				incrLines += ctext.split('\n').length - child.value.split('\n').length;
			} else {
				doFormat(node);
			}
		}
	};
	doFormat(result);
}

export function formatting(document: vscode.TextDocument, diagnosticCollection?: vscode.DiagnosticCollection): string {
	const options: ExtendedOptions = {
		tabWidth: 4,
		useTabs: true,
		printWidth: 5000,
		semi: true,
		singleQuote: true,
		trailingComma: 'es5',

		twigPrintWidth: 5000,
		twigMultiTags: ['with,endwith'],
		twigAlwaysBreakObjects: false,
		twigSingleQuote: true,
		parser: 'melody',
		htmlWhitespaceSensitivity: 'ignore',
		embeddedLanguageFormatting: 'auto',
	};

	Object.assign(options, prettier.resolveConfig.sync(document.uri.fsPath) ?? []);

	const doc = { text: document.getText() };
	try {
		doc.text = prettier.format(doc.text, options);

		if (!doc.text) {
			throw new Error('Error during prettier formatting.');
		}

		formatStyleAndScript(doc, options);
		diagnosticCollection?.clear();
	} catch (error) {
		const e = error as FormattingError;

		if (diagnosticCollection && e.loc) {
			diagnosticCollection.clear();
			const loc = e.loc;
			if (!loc.end) {
				loc.end = { line: loc.start.line, column: loc.start.column + 1 };
			}
			const line = loc.start.line - 1,
				col = loc.start.column - 1;
			const line2 = loc.end.line - 1,
				col2 = loc.end.column - 1;
			const range = new vscode.Range(line, col, line2, col2);
			setTimeout(
				() =>
					diagnosticCollection.set(document.uri, [
						new vscode.Diagnostic(range, e.message.split(' \t ')[0].split('\n')[0], 0),
					]),
				250
			);
		} else {
			console.warn(`An error occured during formatting: ${e.message}`);
		}
	}

	return doc.text;
}
