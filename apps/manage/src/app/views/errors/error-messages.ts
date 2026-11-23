export type ErrorMessage = string | { href: string; message: string };
export type ErrorRenderData = {
	pageHeading: string;
	messages: ErrorMessage[];
};

export const RULESET_ERROR_MESSAGE: ErrorRenderData = {
	pageHeading: 'Sorry, there is a problem with the service',
	messages: [
		{
			href: '',
			message: 'Refresh the page to try again'
		},
		'If you leave this page you will have to start this process again.'
	]
};
