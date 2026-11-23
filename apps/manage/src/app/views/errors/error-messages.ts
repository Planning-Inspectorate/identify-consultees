export type ErrorMessage = string | { href: string; message: string };
export type ErrorRenderData = {
	pageHeading: string;
	messages: ErrorMessage[];
	backLinkText?: string;
	backlinkUrl?: string;
};

export function generateRuleSetError({
	backLinkText = '',
	backLinkUrl = ''
}: {
	backLinkText?: string;
	backLinkUrl?: string;
} = {}): ErrorRenderData {
	return {
		...(backLinkText ? { backLinkText } : {}),
		...(backLinkUrl ? { backLinkUrl } : {}),
		pageHeading: 'Sorry, there is a problem with the service',
		messages: [
			{
				href: '',
				message: 'Refresh the page to try again'
			},
			'If you leave this page you will have to start this process again.'
		]
	};
}
