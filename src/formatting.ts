import { format, Options, ParserOptions, resolveConfig } from 'prettier';
import { Diagnostic, DiagnosticCollection, Range, TextDocument } from 'vscode';
import * as htmlPlugin from 'prettier/parser-html';

type ExtendedOptions = Options &
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

export function formatting(document: TextDocument, diagnosticCollection?: DiagnosticCollection): string {
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

	Object.assign(options, resolveConfig.sync(document.uri.fsPath) ?? []);

	const doc = { text: document.getText() };
	try {
		doc.text = format(doc.text, options);

		if (!doc.text) {
			throw new Error('this fucking shit of formatting failed again 💩');
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
			const range = new Range(line, col, line2, col2);
			setTimeout(
				() =>
					diagnosticCollection.set(document.uri, [
						new Diagnostic(range, e.message.split(' \t ')[0].split('\n')[0], 0),
					]),
				250
			);
		} else {
			console.warn(`An error occured during formatting: ${e.message}`);
		}
	}

	return doc.text;
}

// Formats the <style> and <script> tags using their respective parsers
function formatStyleAndScript(doc: { text: string }, options: Options) {
	let indent = '  ';
	if (options.useTabs) {
		indent = '\t';
	} else {
		if (options.tabWidth) {
			indent = ' '.repeat(options.tabWidth);
		}
	}
	const eol = doc.text.includes('\r\n') ? '\r\n' : '\n';

	const result = htmlPlugin.parsers.html.parse(doc.text, {}, {} as ParserOptions);
	let incrChars = 0;
	let incrLines = 0;

	const doFormat = (root) => {
		if (!root.children) return;
		for (const element of root.children) {
			const node = element;
			if (node.type == 'element' && (node.name == 'script' || node.name == 'style')) {
				if (node.children.length == 0) {
					continue;
				}

				if (node.prev && node.prev.value) {
					const pv = node.prev.value.trim();
					if (pv.endsWith('{# prettier-ignore #}') || pv.endsWith('{% comment %}')) {
						continue;
					}
				}

				const child = node.children[0];
				let ctext = child.value;
				if (ctext.trim()) {
					options.parser = node.name == 'script' ? 'babel' : 'css';

					const tagOffset = node.sourceSpan.start.offset;
					let tagOffset2 = tagOffset;
					while (tagOffset2 > -1) {
						if (doc.text[tagOffset2 + incrChars] == '\n') {
							break;
						}
						tagOffset2--;
					}
					const tagIndent = doc.text
						.slice(tagOffset2 + 1 + incrChars, tagOffset + incrChars)
						.replace(/\S/g, ' ');

					ctext =
						'\n'.repeat(child.sourceSpan.start.line + incrLines) +
						' '.repeat(child.sourceSpan.start.col) +
						child.value; //keep the line and column for error tips
					ctext =
						eol +
						format(ctext, options)
							.trim()
							.split(eol)
							.map((line) => tagIndent + indent + line)
							.join(eol) +
						eol +
						tagIndent;
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
