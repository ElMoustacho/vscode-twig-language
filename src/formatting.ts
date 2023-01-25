import { format, Options, ParserOptions, resolveConfig } from 'prettier';
import { Diagnostic, DiagnosticCollection, Range, TextDocument } from 'vscode';
import * as htmlPlugin from 'prettier/parser-html';
import * as djangoPlugin from 'prettier-plugin-django';

export function formatting(document: TextDocument, diagnosticCollection?: DiagnosticCollection): string {
	const defaultOptions = {
		tabWidth: 4,
		printWidth: 5000,
		semi: false,
		singleQuote: true,
		trailingComma: 'none',

		twigPrintWidth: 5000,
		twigMultiTags: ['with,endwith'],
		twigAlwaysBreakObjects: false,
		twigSingleQuote: true,
		parser: 'melody',
		plugins: [],
		htmlWhitespaceSensitivity: 'ignore',
		embeddedLanguageFormatting: 'auto',
	};
	Object.assign(defaultOptions, resolveConfig.sync(document.uri.fsPath) ?? []);
	defaultOptions.twigSingleQuote = true;
	defaultOptions.plugins = [djangoPlugin];
	defaultOptions.parser = 'melody';
	defaultOptions.htmlWhitespaceSensitivity = 'ignore';
	defaultOptions.embeddedLanguageFormatting = 'off';

	const doc = { text: document.getText() };
	try {
		doc.text = format(doc.text, defaultOptions as Options);
		if (!doc.text) {
			throw new Error('django-html: formatting failed');
		}

		//if use `prettier-plugin-django`, can't get the error tips, so don't use it
		formatStyleAndScript(doc, defaultOptions as Options);
		diagnosticCollection?.clear();
	} catch (error) {
		if (diagnosticCollection && error.loc) {
			diagnosticCollection.clear();
			const loc = error.loc;
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
						new Diagnostic(range, error.message.split(' \t ')[0].split('\n')[0], 0),
					]),
				250
			);
		} else {
			console.log(error);
		}
	}
	return doc.text;
}

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

	const result = htmlPlugin.parsers.html.parse(doc.text, null, {} as ParserOptions);
	let incrChars = 0;
	let incrLines = 0;
	const doFormat = (root) => {
		if (!root.children) return;
		for (let i = 0; i < root.children.length; i++) {
			const node = root.children[i];
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
