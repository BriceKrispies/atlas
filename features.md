Tokens Admin - page
	- allows arbitrary text tokens to be defined as small code snippets that can read from any other part of the system (might have to work through this)
	- examples
		- admin wants to send email to a user with a [site_url] token. When emailer is building email to be sent, calls token registry and replaces anywhere 
		  in there with the value of that token.
		- admin wants to send email that has dynamic token, something like [current_user_points], that can read how many points the user currently has

Email Templates Admin - page
	- allows user to create/save/edit email templates that can be used by other parts of the system when sending an email

Business Unit Admin - page
	- allows tenant admin to create/manage 'business units', which are a list of any user in the system, or other business units
	- makes these business units globally available to any other widgets that might need them (messaging)
	- make searching/adding users seamless, allow searching for things like 'all users with this in the username', or 'all user in this role'

Announcements Widget
	- allow tenant admin to display arbitrary message or file

Points Admin - page
	- allows tenant admin to define point system
	- lets them set arbitrary value to points, defaults to 1 point ~ 50cents

Messaging Widget
	- allows arbitrary configuration of who can send and view messages for business units in the system

Email Notifications - Page (admin)
	- shows all emails that have been sent in the system
	- shows where from/who from, when, keeps track of status
	- filterable, searchable by email subject/content/user

Intents History - Page
	- keeps track of all users 'intents' (activities) done in the system, displays in filterable list
	- read only

Media Library - Page 
	- allows user to upload and view any file, page makes best attempt at displaying, page makes library searchable and allows user to put files into
	categories defined by tenant admin
	- files private by default
	- if file is made public, can be linked to anywhere on the site
	- has placeholder so that if file is made private again, doesnt break site look

Spreadsheet Uploader - Widget
	- allows user to configure widget to allow basically arbitrary spreadsheets (csv or xlsx), which get validated and can produce intents
	- (maybe its own table?)
	- has dry run, rich validation features
	- history
	- (maybe admin only)
	- examples (that can be built off it)
		- allow tenant admin to upload points for their users, keyed by either username or id
		- allow tenant admin to upload user data (for bulk new user creation)

Badges - Page
	- keeps track of intents done by any user of the system
	- allows choosing files from media library for the 'badge'
	- allows rewarding 'points' from system to user
	- based on intents/roles, awards configured amount of points, then sends email saying they earned a badge

