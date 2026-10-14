export interface CbosCheck {
	status: 'OK' | 'ERROR';
	detail: string;
}

export interface CbosConnectionViewModel {
	pageHeading: string;
	database?: CbosCheck;
	storage?: CbosCheck;
	error?: string;
}
