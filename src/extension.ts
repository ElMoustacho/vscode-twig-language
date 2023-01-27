import { commands, ExtensionContext, languages, TextEdit, Range, window, Hover, DiagnosticCollection } from 'vscode';
import * as filtersArr from './hover/filters.json';
import * as functionsArr from './hover/functions.json';
import * as twigArr from './hover/twig.json';
import { formatting } from './formatting';
import { clearVirtualDocumentContents, createVirtualDoc, registerTextDocumentEvents } from './virtualDocument';

type HoverSnippet = {
	example?: string;
	description?: string;
	prefix?: string;
	body?: string | string[];
	text?: string;
};

type HoverSnippetObj = { [key: string]: HoverSnippet };

function createHover(snippet: HoverSnippet, type: string) {
	const example = typeof snippet.example == 'undefined' ? '' : snippet.example;
	const description = typeof snippet.description == 'undefined' ? '' : snippet.description;

	return new Hover({
		language: type,
		value: description + '\n\n' + example,
	});
}

function registerDocType(type: string, context: ExtensionContext, diagnosticCollection: DiagnosticCollection) {
	context.subscriptions.push(
		languages.registerHoverProvider(type, {
			async provideHover(document, position) {
				const range = document.getWordRangeAtPosition(position);
				const word = document.getText(range);

				for (const filter of Object.values(filtersArr as HoverSnippetObj)) {
					if ('prefix' in filter && filter.prefix == word) {
						return createHover(filter, type);
					}
				}

				for (const func of Object.values(functionsArr as HoverSnippetObj)) {
					if ('prefix' in func && func.prefix == word) {
						return createHover(func, type);
					}
				}

				for (const keyword of Object.values(twigArr as HoverSnippetObj)) {
					if ('prefix' in keyword && keyword.prefix == word) {
						return createHover(keyword, type);
					}
				}

				const vdocUri = createVirtualDoc(document, type);
				const hs: Hover[] = await commands.executeCommand('vscode.executeHoverProvider', vdocUri, position);
				return hs?.[0];
			},
		})
	);

	context.subscriptions.push(
		languages.registerDocumentFormattingEditProvider(type, {
			provideDocumentFormattingEdits: async (document, _options, _token) => {
				const otext = document.getText();
				if (!otext) {
					return;
				}
				const newDoc = document;

				const text = formatting(newDoc, diagnosticCollection);

				if (text && text != otext) {
					const range = new Range(document.positionAt(0), document.positionAt(otext.length));
					return [new TextEdit(range, text)];
				} else {
					return [];
				}
			},
		})
	);

	context.subscriptions.push(
		languages.registerCompletionItemProvider(
			type,
			{
				provideCompletionItems: async (document, position, _token, context) => {
					const vdocUri = createVirtualDoc(document, type);
					return await commands.executeCommand(
						'vscode.executeCompletionItemProvider',
						vdocUri,
						position,
						context.triggerCharacter
					);
				},
			},
			'.',
			'(',
			':',
			'<'
		)
	);
}

export function activate(context: ExtensionContext) {
	const active = window.activeTextEditor;
	if (!active || !active.document) return;

	const diagnosticCollection = languages.createDiagnosticCollection('twig');
	context.subscriptions.push(diagnosticCollection);

	registerDocType('twig', context, diagnosticCollection);
	registerTextDocumentEvents(context, ['twig']);
}

export function deactivate() {
	clearVirtualDocumentContents();
	return undefined;
}
