/* @ds-bundle: {"format":4,"namespace":"Grasso","components":[{"name":"Button"},{"name":"Input"},{"name":"Card"},{"name":"Badge"},{"name":"Tabs"},{"name":"Switch"},{"name":"Alert"},{"name":"ChartCard"},{"name":"AreaChart"},{"name":"BarChart"},{"name":"LineChart"},{"name":"DonutChart"},{"name":"RadialChart"},{"name":"Checkbox"},{"name":"RadioGroup"},{"name":"Select"},{"name":"Textarea"},{"name":"Slider"},{"name":"Progress"},{"name":"Avatar"},{"name":"Table"},{"name":"StatCard"},{"name":"Tooltip"},{"name":"Dialog"},{"name":"Menu"},{"name":"TaskSteps"},{"name":"CodeBlock"},{"name":"Attachments"},{"name":"Icon"},{"name":"FileIcon"},{"name":"Breadcrumb"},{"name":"Pagination"},{"name":"Accordion"},{"name":"ToggleGroup"},{"name":"Popover"},{"name":"Sheet"},{"name":"Toaster"},{"name":"Skeleton"},{"name":"EmptyState"},{"name":"Calendar"},{"name":"DatePicker"},{"name":"Combobox"},{"name":"CommandPalette"},{"name":"InputOTP"},{"name":"Separator"},{"name":"Spinner"},{"name":"Tag"},{"name":"NumberInput"},{"name":"FileUpload"},{"name":"DescriptionList"},{"name":"Stepper"},{"name":"MenuBar"},{"name":"Toolbar"},{"name":"DocTabs"},{"name":"TreeView"},{"name":"Inspector"},{"name":"ColorPicker"},{"name":"SplitPane"},{"name":"ContextMenu"},{"name":"StatusBar"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;
  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }
  function omit(obj, keys) {
    var r = {};
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && keys.indexOf(k) < 0) r[k] = obj[k];
    return r;
  }

  // ----------------------------------------------------------------------
  // Icons: Lucide (https://lucide.dev, ISC licence) — the community fork of
  // Feather. 24-unit grid, 2px round strokes. Only the glyphs this system uses
  // (plus common app icons) are inlined; add more from lucide-static's
  // icon-nodes.json in the same [tag, attrs] shape.
  // ----------------------------------------------------------------------
  var LUCIDE = {"check":[["path",{"d":"M20 6 9 17l-5-5"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"plus":[["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],"minus":[["path",{"d":"M5 12h14"}]],"chevron-down":[["path",{"d":"m6 9 6 6 6-6"}]],"chevron-right":[["path",{"d":"m9 18 6-6-6-6"}]],"chevron-left":[["path",{"d":"m15 18-6-6 6-6"}]],"arrow-up":[["path",{"d":"m5 12 7-7 7 7"}],["path",{"d":"M12 19V5"}]],"arrow-down":[["path",{"d":"M12 5v14"}],["path",{"d":"m19 12-7 7-7-7"}]],"arrow-right":[["path",{"d":"M5 12h14"}],["path",{"d":"m12 5 7 7-7 7"}]],"copy":[["rect",{"width":"14","height":"14","x":"8","y":"8","rx":"2","ry":"2"}],["path",{"d":"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"}]],"rotate-cw":[["path",{"d":"M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}]],"thumbs-up":[["path",{"d":"M7 10v12"}],["path",{"d":"M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"}]],"thumbs-down":[["path",{"d":"M17 14V2"}],["path",{"d":"M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"}]],"pencil":[["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{"d":"m15 5 4 4"}]],"search":[["circle",{"cx":"11","cy":"11","r":"8"}],["path",{"d":"m21 21-4.3-4.3"}]],"globe":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"}],["path",{"d":"M2 12h20"}]],"info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"circle-check":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m9 12 2 2 4-4"}]],"triangle-alert":[["path",{"d":"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{"d":"M12 9v4"}],["path",{"d":"M12 17h.01"}]],"circle-x":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m15 9-6 6"}],["path",{"d":"m9 9 6 6"}]],"trending-up":[["polyline",{"points":"22 7 13.5 15.5 8.5 10.5 2 17"}],["polyline",{"points":"16 7 22 7 22 13"}]],"trending-down":[["polyline",{"points":"22 17 13.5 8.5 8.5 13.5 2 7"}],["polyline",{"points":"16 17 22 17 22 11"}]],"paperclip":[["path",{"d":"m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"}]],"square":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}]],"mic":[["path",{"d":"M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"}],["path",{"d":"M19 10v2a7 7 0 0 1-14 0v-2"}],["line",{"x1":"12","x2":"12","y1":"19","y2":"22"}]],"settings":[["path",{"d":"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"user":[["path",{"d":"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"}],["circle",{"cx":"12","cy":"7","r":"4"}]],"users":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["path",{"d":"M16 3.13a4 4 0 0 1 0 7.75"}]],"bell":[["path",{"d":"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"}],["path",{"d":"M10.3 21a1.94 1.94 0 0 0 3.4 0"}]],"calendar":[["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M3 10h18"}]],"star":[["path",{"d":"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"}]],"heart":[["path",{"d":"M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"}]],"share-2":[["circle",{"cx":"18","cy":"5","r":"3"}],["circle",{"cx":"6","cy":"12","r":"3"}],["circle",{"cx":"18","cy":"19","r":"3"}],["line",{"x1":"8.59","x2":"15.42","y1":"13.51","y2":"17.49"}],["line",{"x1":"15.41","x2":"8.59","y1":"6.51","y2":"10.49"}]],"download":[["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["polyline",{"points":"7 10 12 15 17 10"}],["line",{"x1":"12","x2":"12","y1":"15","y2":"3"}]],"upload":[["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["polyline",{"points":"17 8 12 3 7 8"}],["line",{"x1":"12","x2":"12","y1":"3","y2":"15"}]],"trash-2":[["path",{"d":"M3 6h18"}],["path",{"d":"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"}],["path",{"d":"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"}],["line",{"x1":"10","x2":"10","y1":"11","y2":"17"}],["line",{"x1":"14","x2":"14","y1":"11","y2":"17"}]],"ellipsis":[["circle",{"cx":"12","cy":"12","r":"1"}],["circle",{"cx":"19","cy":"12","r":"1"}],["circle",{"cx":"5","cy":"12","r":"1"}]],"external-link":[["path",{"d":"M15 3h6v6"}],["path",{"d":"M10 14 21 3"}],["path",{"d":"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}]],"menu":[["line",{"x1":"4","x2":"20","y1":"12","y2":"12"}],["line",{"x1":"4","x2":"20","y1":"6","y2":"6"}],["line",{"x1":"4","x2":"20","y1":"18","y2":"18"}]],"log-out":[["path",{"d":"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}],["polyline",{"points":"16 17 21 12 16 7"}],["line",{"x1":"21","x2":"9","y1":"12","y2":"12"}]],"filter":[["polygon",{"points":"22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"}]],"eye":[["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"lock":[["rect",{"width":"18","height":"11","x":"3","y":"11","rx":"2","ry":"2"}],["path",{"d":"M7 11V7a5 5 0 0 1 10 0v4"}]],"house":[["path",{"d":"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"}],["path",{"d":"M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"}]],"image":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2","ry":"2"}],["circle",{"cx":"9","cy":"9","r":"2"}],["path",{"d":"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"}]],"link":[["path",{"d":"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"}],["path",{"d":"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"}]],"message-square":[["path",{"d":"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"}]],"sun":[["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M12 20v2"}],["path",{"d":"m4.93 4.93 1.41 1.41"}],["path",{"d":"m17.66 17.66 1.41 1.41"}],["path",{"d":"M2 12h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"m6.34 17.66-1.41 1.41"}],["path",{"d":"m19.07 4.93-1.41 1.41"}]],"moon":[["path",{"d":"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"}]],"clock":[["circle",{"cx":"12","cy":"12","r":"10"}],["polyline",{"points":"12 6 12 12 16 14"}]],"map-pin":[["path",{"d":"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"}],["circle",{"cx":"12","cy":"10","r":"3"}]],"folder":[["path",{"d":"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"}]],"file":[["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}]],"file-text":[["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],"file-spreadsheet":[["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{"d":"M8 13h2"}],["path",{"d":"M14 13h2"}],["path",{"d":"M8 17h2"}],["path",{"d":"M14 17h2"}]],"file-image":[["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["circle",{"cx":"10","cy":"12","r":"2"}],["path",{"d":"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22"}]],"file-code":[["path",{"d":"M10 12.5 8 15l2 2.5"}],["path",{"d":"m14 12.5 2 2.5-2 2.5"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"}]],"file-archive":[["path",{"d":"M10 12v-1"}],["path",{"d":"M10 18v-2"}],["path",{"d":"M10 7V6"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{"d":"M15.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v16a2 2 0 0 0 .274 1.01"}],["circle",{"cx":"10","cy":"20","r":"2"}]],"file-audio":[["path",{"d":"M17.5 22h.5a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{"d":"M2 19a2 2 0 1 1 4 0v1a2 2 0 1 1-4 0v-4a6 6 0 0 1 12 0v4a2 2 0 1 1-4 0v-1a2 2 0 1 1 4 0"}]],"file-video":[["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{"d":"m10 11 5 3-5 3v-6Z"}]],"file-json":[["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{"d":"M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"}],["path",{"d":"M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"}]],"presentation":[["path",{"d":"M2 3h20"}],["path",{"d":"M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"}],["path",{"d":"m7 21 5-5 5 5"}]],"lightbulb":[["path",{"d":"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"}],["path",{"d":"M9 18h6"}],["path",{"d":"M10 22h4"}]],"book-open":[["path",{"d":"M12 7v14"}],["path",{"d":"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"}]],"chart-column":[["path",{"d":"M3 3v16a2 2 0 0 0 2 2h16"}],["path",{"d":"M18 17V9"}],["path",{"d":"M13 17V5"}],["path",{"d":"M8 17v-3"}]],"pen-line":[["path",{"d":"M12 20h9"}],["path",{"d":"M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"}]],"sparkles":[["path",{"d":"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"}],["path",{"d":"M20 3v4"}],["path",{"d":"M22 5h-4"}],["path",{"d":"M4 17v2"}],["path",{"d":"M5 18H3"}]],"scroll-text":[["path",{"d":"M15 12h-5"}],["path",{"d":"M15 8h-5"}],["path",{"d":"M19 17V5a2 2 0 0 0-2-2H4"}],["path",{"d":"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"}]],"align-left":[["path",{"d":"M15 12H3"}],["path",{"d":"M17 18H3"}],["path",{"d":"M21 6H3"}]],"table":[["path",{"d":"M12 3v18"}],["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M3 9h18"}],["path",{"d":"M3 15h18"}]],"chart-pie":[["path",{"d":"M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"}],["path",{"d":"M21.21 15.89A10 10 0 1 1 8 2.83"}]],"play":[["polygon",{"points":"6 3 20 12 6 21 6 3"}]],"music":[["path",{"d":"M9 18V5l12-2v13"}],["circle",{"cx":"6","cy":"18","r":"3"}],["circle",{"cx":"18","cy":"16","r":"3"}]],"package":[["path",{"d":"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"}],["path",{"d":"M12 22V12"}],["path",{"d":"m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"}],["path",{"d":"m7.5 4.27 9 5.15"}]],"code":[["polyline",{"points":"16 18 22 12 16 6"}],["polyline",{"points":"8 6 2 12 8 18"}]],"braces":[["path",{"d":"M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"}],["path",{"d":"M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"}]],"layout-dashboard":[["rect",{"width":"7","height":"9","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"5","x":"14","y":"3","rx":"1"}],["rect",{"width":"7","height":"9","x":"14","y":"12","rx":"1"}],["rect",{"width":"7","height":"5","x":"3","y":"16","rx":"1"}]],"inbox":[["polyline",{"points":"22 12 16 12 14 15 10 15 8 12 2 12"}],["path",{"d":"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"}]],"panel-left":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M9 3v18"}]],"command":[["path",{"d":"M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"}]],"circle-help":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"}],["path",{"d":"M12 17h.01"}]],"mail":[["rect",{"width":"20","height":"16","x":"2","y":"4","rx":"2"}],["path",{"d":"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"}]],"compass":[["path",{"d":"m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"}],["circle",{"cx":"12","cy":"12","r":"10"}]],"bookmark":[["path",{"d":"m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"}]],"history":[["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}],["path",{"d":"M12 7v5l4 2"}]],"refresh-cw":[["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{"d":"M8 16H3v5"}]],"circle-plus":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M8 12h8"}],["path",{"d":"M12 8v8"}]],"file-plus":[["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{"d":"M9 15h6"}],["path",{"d":"M12 18v-6"}]],"folder-open":[["path",{"d":"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"}]],"save":[["path",{"d":"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"}],["path",{"d":"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"}],["path",{"d":"M7 3v4a1 1 0 0 0 1 1h7"}]],"undo-2":[["path",{"d":"M9 14 4 9l5-5"}],["path",{"d":"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"}]],"redo-2":[["path",{"d":"m15 14 5-5-5-5"}],["path",{"d":"M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"}]],"mouse-pointer-2":[["path",{"d":"M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"}]],"move":[["path",{"d":"M12 2v20"}],["path",{"d":"m15 19-3 3-3-3"}],["path",{"d":"m19 9 3 3-3 3"}],["path",{"d":"M2 12h20"}],["path",{"d":"m5 9-3 3 3 3"}],["path",{"d":"m9 5 3-3 3 3"}]],"circle":[["circle",{"cx":"12","cy":"12","r":"10"}]],"type":[["polyline",{"points":"4 7 4 4 20 4 20 7"}],["line",{"x1":"9","x2":"15","y1":"20","y2":"20"}],["line",{"x1":"12","x2":"12","y1":"4","y2":"20"}]],"hand":[["path",{"d":"M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"}],["path",{"d":"M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"}],["path",{"d":"M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"}],["path",{"d":"M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"}]],"zoom-in":[["circle",{"cx":"11","cy":"11","r":"8"}],["line",{"x1":"21","x2":"16.65","y1":"21","y2":"16.65"}],["line",{"x1":"11","x2":"11","y1":"8","y2":"14"}],["line",{"x1":"8","x2":"14","y1":"11","y2":"11"}]],"zoom-out":[["circle",{"cx":"11","cy":"11","r":"8"}],["line",{"x1":"21","x2":"16.65","y1":"21","y2":"16.65"}],["line",{"x1":"8","x2":"14","y1":"11","y2":"11"}]],"grid-3x3":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M3 9h18"}],["path",{"d":"M3 15h18"}],["path",{"d":"M9 3v18"}],["path",{"d":"M15 3v18"}]],"layers":[["path",{"d":"m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"}],["path",{"d":"m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"}],["path",{"d":"m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"}]],"eye-off":[["path",{"d":"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"}],["path",{"d":"M14.084 14.158a3 3 0 0 1-4.242-4.242"}],["path",{"d":"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"}],["path",{"d":"m2 2 20 20"}]],"lock-open":[["rect",{"width":"18","height":"11","x":"3","y":"11","rx":"2","ry":"2"}],["path",{"d":"M7 11V7a5 5 0 0 1 9.9-1"}]],"box":[["path",{"d":"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"}],["path",{"d":"m3.3 7 8.7 5 8.7-5"}],["path",{"d":"M12 22V12"}]],"git-branch":[["line",{"x1":"6","x2":"6","y1":"3","y2":"15"}],["circle",{"cx":"18","cy":"6","r":"3"}],["circle",{"cx":"6","cy":"18","r":"3"}],["path",{"d":"M18 9a9 9 0 0 1-9 9"}]],"scissors":[["circle",{"cx":"6","cy":"6","r":"3"}],["path",{"d":"M8.12 8.12 12 12"}],["path",{"d":"M20 4 8.12 15.88"}],["circle",{"cx":"6","cy":"18","r":"3"}],["path",{"d":"M14.8 14.8 20 20"}]],"clipboard":[["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1","ry":"1"}],["path",{"d":"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"}]],"pen-tool":[["path",{"d":"M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"}],["path",{"d":"m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"}],["path",{"d":"m2.3 2.3 7.286 7.286"}],["circle",{"cx":"11","cy":"11","r":"2"}]],"ruler":[["path",{"d":"M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"}],["path",{"d":"m14.5 12.5 2-2"}],["path",{"d":"m11.5 9.5 2-2"}],["path",{"d":"m8.5 6.5 2-2"}],["path",{"d":"m17.5 15.5 2-2"}]],"maximize-2":[["polyline",{"points":"15 3 21 3 21 9"}],["polyline",{"points":"9 21 3 21 3 15"}],["line",{"x1":"21","x2":"14","y1":"3","y2":"10"}],["line",{"x1":"3","x2":"10","y1":"21","y2":"14"}]],"pipette":[["path",{"d":"m2 22 1-1h3l9-9"}],["path",{"d":"M3 21v-3l9-9"}],["path",{"d":"m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"}]],"palette":[["circle",{"cx":"13.5","cy":"6.5","r":".5","fill":"currentColor"}],["circle",{"cx":"17.5","cy":"10.5","r":".5","fill":"currentColor"}],["circle",{"cx":"8.5","cy":"7.5","r":".5","fill":"currentColor"}],["circle",{"cx":"6.5","cy":"12.5","r":".5","fill":"currentColor"}],["path",{"d":"M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"}]],"sliders-horizontal":[["line",{"x1":"21","x2":"14","y1":"4","y2":"4"}],["line",{"x1":"10","x2":"3","y1":"4","y2":"4"}],["line",{"x1":"21","x2":"12","y1":"12","y2":"12"}],["line",{"x1":"8","x2":"3","y1":"12","y2":"12"}],["line",{"x1":"21","x2":"16","y1":"20","y2":"20"}],["line",{"x1":"12","x2":"3","y1":"20","y2":"20"}],["line",{"x1":"14","x2":"14","y1":"2","y2":"6"}],["line",{"x1":"8","x2":"8","y1":"10","y2":"14"}],["line",{"x1":"16","x2":"16","y1":"18","y2":"22"}]],"frame":[["line",{"x1":"22","x2":"2","y1":"6","y2":"6"}],["line",{"x1":"22","x2":"2","y1":"18","y2":"18"}],["line",{"x1":"6","x2":"6","y1":"2","y2":"22"}],["line",{"x1":"18","x2":"18","y1":"2","y2":"22"}]],"cpu":[["rect",{"width":"16","height":"16","x":"4","y":"4","rx":"2"}],["rect",{"width":"6","height":"6","x":"9","y":"9","rx":"1"}],["path",{"d":"M15 2v2"}],["path",{"d":"M15 20v2"}],["path",{"d":"M2 15h2"}],["path",{"d":"M2 9h2"}],["path",{"d":"M20 15h2"}],["path",{"d":"M20 9h2"}],["path",{"d":"M9 2v2"}],["path",{"d":"M9 20v2"}]],"monitor":[["rect",{"width":"20","height":"14","x":"2","y":"3","rx":"2"}],["line",{"x1":"8","x2":"16","y1":"21","y2":"21"}],["line",{"x1":"12","x2":"12","y1":"17","y2":"21"}]],"magnet":[["path",{"d":"m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"}],["path",{"d":"m5 8 4 4"}],["path",{"d":"m12 15 4 4"}]]};
  function glyphNodes(name) {
    return (LUCIDE[name] || []).map(function (n, i) { var a = {}; for (var k in n[1]) a[k] = n[1][k]; a.key = i; return h(n[0], a); });
  }
  function glyph(name, size, sw) {
    return h('svg', { className: 'gr-icon', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: sw || 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, glyphNodes(name));
  }
  function Icon(props) {
    var el = glyph(props.name, props.size || 16, props.strokeWidth);
    if (!props.label && !props.className && !props.style) return el;
    return h('span', { className: cx('gr-icon-wrap', props.className), style: props.style, role: props.label ? 'img' : undefined, 'aria-label': props.label }, el);
  }

  function Button(props) {
    var variant = props.variant || 'glass';
    var size = props.size || 'md';
    var rest = omit(props, ['variant', 'size', 'className', 'children', 'type']);
    rest.type = props.type || 'button';
    rest.className = cx('gr-btn', 'gr-btn-' + variant, 'gr-btn-' + size, props.className);
    return h('button', rest, props.children);
  }

  var uid = 0;
  function Input(props) {
    var idRef = React.useRef(null);
    if (idRef.current === null) idRef.current = props.id || 'gr-input-' + (++uid);
    var id = idRef.current;
    var rest = omit(props, ['label', 'hint', 'error', 'className', 'id', 'icon', 'trailing']);
    rest.id = id;
    rest.className = cx('gr-input', props.error && 'gr-input-invalid', props.icon && 'gr-input-has-icon', props.trailing && 'gr-input-has-trail');
    if (props.error) rest['aria-invalid'] = true;
    if (props.hint || props.error) rest['aria-describedby'] = id + '-msg';
    return h('div', { className: cx('gr-field', props.className) },
      props.label ? h('label', { className: 'gr-label', htmlFor: id }, props.label) : null,
      (props.icon || props.trailing) ? h('span', { className: 'gr-input-wrap' },
        props.icon ? h('span', { className: 'gr-input-icon' }, glyph(props.icon, 16)) : null,
        h('input', rest),
        props.trailing ? h('span', { className: 'gr-input-trail' }, props.trailing) : null) : h('input', rest),
      props.error
        ? h('p', { id: id + '-msg', className: 'gr-msg gr-msg-error' }, props.error)
        : props.hint ? h('p', { id: id + '-msg', className: 'gr-msg' }, props.hint) : null
    );
  }

  function Card(props) {
    var rest = omit(props, ['title', 'eyebrow', 'footer', 'interactive', 'className', 'children']);
    rest.className = cx('gr-card', props.interactive && 'gr-card-interactive', props.className);
    return h('section', rest,
      props.eyebrow ? h('p', { className: 'gr-card-eyebrow' }, props.eyebrow) : null,
      props.title ? h('h3', { className: 'gr-card-title' }, props.title) : null,
      h('div', { className: 'gr-card-body' }, props.children),
      props.footer ? h('div', { className: 'gr-card-footer' }, props.footer) : null
    );
  }

  function Badge(props) {
    var tone = props.tone || 'neutral';
    return h('span', { className: cx('gr-badge', 'gr-badge-' + tone, props.className) }, props.children);
  }

  function Tabs(props) {
    var items = props.items || [];
    var controlled = props.value !== undefined;
    var st = React.useState(props.defaultValue || (items[0] && items[0].value));
    var current = controlled ? props.value : st[0];
    var refs = React.useRef({});
    var th = React.useState(null), thumb = th[0], setThumb = th[1];
    React.useLayoutEffect(function () {
      var el = refs.current[current];
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    }, [current, items.length]);
    function pick(v) {
      if (!controlled) st[1](v);
      if (props.onChange) props.onChange(v);
    }
    return h('div', { className: cx('gr-seg', props.className), role: 'tablist', 'aria-label': props.label },
      thumb ? h('span', { className: 'gr-seg-thumb', style: thumb, 'aria-hidden': true }) : null,
      items.map(function (it) {
        var on = it.value === current;
        return h('button', {
          key: it.value, type: 'button', role: 'tab', 'aria-selected': on,
          tabIndex: on ? 0 : -1, disabled: it.disabled,
          ref: function (el) { refs.current[it.value] = el; },
          className: cx('gr-seg-item', on && 'gr-seg-on'),
          onClick: function () { pick(it.value); }
        }, it.label);
      })
    );
  }

  function Switch(props) {
    var controlled = props.checked !== undefined;
    var st = React.useState(!!props.defaultChecked);
    var on = controlled ? props.checked : st[0];
    function toggle() {
      if (props.disabled) return;
      if (!controlled) st[1](!on);
      if (props.onChange) props.onChange(!on);
    }
    return h('label', { className: cx('gr-switch', props.disabled && 'gr-switch-disabled', props.className) },
      h('button', {
        type: 'button', role: 'switch', 'aria-checked': on, disabled: props.disabled,
        className: cx('gr-switch-track', on && 'gr-switch-on'), onClick: toggle
      }, h('span', { className: 'gr-switch-thumb' })),
      props.label ? h('span', { className: 'gr-switch-label' }, props.label) : null
    );
  }

  var ALERT_ICON = { info: 'info', success: 'circle-check', warning: 'triangle-alert', danger: 'circle-x' };
  function LineIcon(tone) { return h('span', { className: 'gr-alert-icon' }, glyph(ALERT_ICON[tone] || 'info', 18)); }
  function Alert(props) {
    var tone = props.tone || 'info';
    return h('div', { className: cx('gr-alert', 'gr-alert-' + tone, props.className), role: tone === 'danger' ? 'alert' : 'status' },
      LineIcon(tone),
      h('div', { className: 'gr-alert-text' },
        props.title ? h('p', { className: 'gr-alert-title' }, props.title) : null,
        props.children ? h('div', { className: 'gr-alert-body' }, props.children) : null
      )
    );
  }

  // ======================================================================
  // Charts — hand-drawn SVG, no chart library. One engine for area/line,
  // one for bars, one for arcs. Colours: var(--chart-1..8) in fixed order.
  // ======================================================================
  var chartUid = 0;
  function useChartId() {
    var r = React.useRef(null);
    if (r.current === null) r.current = 'grc' + (++chartUid);
    return r.current;
  }
  function useWidth(ref) {
    var st = React.useState(0), w = st[0], setW = st[1];
    React.useLayoutEffect(function () {
      var el = ref.current; if (!el) return;
      setW(el.clientWidth);
      if (typeof ResizeObserver === 'undefined') return;
      var ro = new ResizeObserver(function () { setW(el.clientWidth); });
      ro.observe(el);
      return function () { ro.disconnect(); };
    }, []);
    return w;
  }
  function seriesColor(s, i) { return s.color || 'var(--chart-' + ((i % 8) + 1) + ')'; }
  var nfFull = typeof Intl !== 'undefined' ? new Intl.NumberFormat('zh-CN') : null;
  var nfCompact = typeof Intl !== 'undefined' ? new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }) : null;
  function fmtFull(v) { return nfFull ? nfFull.format(v) : String(v); }
  function fmtAxis(v, top) { return top >= 10000 && nfCompact ? nfCompact.format(v) : fmtFull(v); }
  function niceTicks(max, count) {
    if (!(max > 0)) return [0, 1];
    var raw = max / (count || 4), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
    var out = []; for (var v = 0; v < max + step * 0.001; v += step) out.push(+v.toFixed(10));
    if (out[out.length - 1] < max) out.push(+(out[out.length - 1] + step).toFixed(10));
    return out;
  }
  // monotone cubic (Fritsch–Carlson): smooth, never overshoots the data
  function monotone(pts, cont) {
    var n = pts.length; if (!n) return '';
    var d = (cont ? 'L' : 'M') + pts[0][0] + ' ' + pts[0][1];
    if (n === 1) return d;
    var m = [], t = [], i;
    for (i = 0; i < n - 1; i++) m.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
    t.push(m[0]);
    for (i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
    t.push(m[n - 2]);
    for (i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      var a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { var k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    for (i = 0; i < n - 1; i++) {
      var dx = (pts[i + 1][0] - pts[i][0]) / 3;
      d += 'C' + (pts[i][0] + dx) + ' ' + (pts[i][1] + t[i] * dx) + ' ' + (pts[i + 1][0] - dx) + ' ' + (pts[i + 1][1] - t[i + 1] * dx) + ' ' + pts[i + 1][0] + ' ' + pts[i + 1][1];
    }
    return d;
  }
  function Legend(props) {
    if (!props.items || props.items.length < 2) return null;
    return h('div', { className: 'gr-legend' }, props.items.map(function (it, i) {
      return h('span', { key: i, className: 'gr-legend-item' },
        h('span', { className: props.kind === 'line' ? 'gr-legend-line' : 'gr-legend-swatch', style: { background: it.color } }),
        h('span', null, it.label));
    }));
  }
  function Tip(props) {
    if (!props.open) return null;
    var w = props.width, left = props.x + 14;
    var style = { top: props.y, left: left };
    if (left + 168 > w) { style.left = 'auto'; style.right = Math.max(0, w - props.x + 14); }
    return h('div', { className: 'gr-tip', style: style, role: 'presentation' },
      props.title != null ? h('div', { className: 'gr-tip-title' }, props.title) : null,
      props.rows.map(function (r, i) {
        return h('div', { key: i, className: 'gr-tip-row' },
          h('span', { className: 'gr-tip-key', style: { background: r.color } }),
          h('span', { className: 'gr-tip-label' }, r.label),
          h('span', { className: 'gr-tip-val' }, r.value));
      }));
  }
  function SrTable(props) {
    return h('table', { className: 'gr-sr' },
      h('caption', null, props.caption || '图表数据'),
      h('thead', null, h('tr', null, h('th', null, props.head), props.cols.map(function (c, i) { return h('th', { key: i }, c); }))),
      h('tbody', null, props.rows.map(function (r, i) {
        return h('tr', { key: i }, h('th', null, r[0]), r.slice(1).map(function (c, j) { return h('td', { key: j }, c); }));
      })));
  }
  function useHover(n) {
    var st = React.useState(null), idx = st[0], setIdx = st[1];
    function onKey(e) {
      if (e.key === 'ArrowRight') { setIdx(idx === null ? 0 : Math.min(n - 1, idx + 1)); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { setIdx(idx === null ? n - 1 : Math.max(0, idx - 1)); e.preventDefault(); }
      else if (e.key === 'Escape') setIdx(null);
    }
    return { idx: idx, setIdx: setIdx, onKey: onKey };
  }

  // ---------- area & line: one engine ----------
  function XY(props, kind) {
    var data = props.data || [], series = props.series || [], xKey = props.xKey || 'label';
    var H = props.height || 240, fmt = props.valueFormat || fmtFull;
    var ref = React.useRef(null), W = useWidth(ref), id = useChartId(), hv = useHover(data.length);
    var stacked = kind === 'area' && props.stacked;
    var yAxis = props.yAxis !== false;
    var top = 12, bottom = 28, right = 8, left = yAxis ? 44 : 8;
    var iw = Math.max(0, W - left - right), ih = H - top - bottom, n = data.length;
    var base = data.map(function () { return 0; });
    var layers = series.map(function (s) {
      var lo = base.slice(), hi = data.map(function (d, i) { return (stacked ? base[i] : 0) + (+d[s.key] || 0); });
      if (stacked) base = hi;
      return { lo: stacked ? lo : data.map(function () { return 0; }), hi: hi };
    });
    var max = 0; layers.forEach(function (l) { l.hi.forEach(function (v) { if (v > max) max = v; }); });
    var ticks = niceTicks(max, 4), tmax = ticks[ticks.length - 1];
    function X(i) { return left + (n < 2 ? iw / 2 : i * iw / (n - 1)); }
    function Y(v) { return top + ih * (1 - v / tmax); }
    var every = Math.max(1, Math.ceil(n * 52 / Math.max(iw, 1)));
    var kids = [];
    if (W > 0) {
      // pixel dither: 2px squares on a 4px checker, fading out toward the baseline
      kids.push(h('defs', { key: 'd' },
        h('pattern', { id: id + 'dp', width: 4, height: 4, patternUnits: 'userSpaceOnUse' },
          h('rect', { x: 0, y: 0, width: 2, height: 2, fill: '#fff' }),
          h('rect', { x: 2, y: 2, width: 2, height: 2, fill: '#fff' })),
        h('mask', { id: id + 'dm', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H },
          h('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#' + id + 'dp)' })),
        h('linearGradient', { id: id + 'fg', gradientUnits: 'userSpaceOnUse', x1: 0, y1: top, x2: 0, y2: top + ih },
          h('stop', { offset: '0%', stopColor: '#fff', stopOpacity: series.length > 1 && !stacked ? 0.42 : 0.55 }),
          h('stop', { offset: '100%', stopColor: '#fff', stopOpacity: 0 })),
        h('mask', { id: id + 'fm', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H },
          h('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#' + id + 'fg)' }))));
      kids.push(h('g', { key: 'grid', className: 'gr-grid' }, ticks.map(function (t, i) {
        return h('line', { key: i, x1: left, x2: left + iw, y1: Math.round(Y(t)) + 0.5, y2: Math.round(Y(t)) + 0.5 });
      })));
      if (yAxis) kids.push(h('g', { key: 'ya', className: 'gr-axis' }, ticks.map(function (t, i) {
        return h('text', { key: i, x: left - 10, y: Y(t), dy: '0.32em', textAnchor: 'end' }, fmtAxis(t, tmax));
      })));
      kids.push(h('g', { key: 'xa', className: 'gr-axis' }, data.map(function (d, i) {
        if (i % every && i !== n - 1) return null;
        if (i !== n - 1 && n - 1 - i < every) return null;
        return h('text', { key: i, x: X(i), y: H - 8, textAnchor: n < 2 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, d[xKey]);
      })));
      layers.forEach(function (l, si) {
        var s = series[si], col = seriesColor(s, si);
        var hiPts = l.hi.map(function (v, i) { return [X(i), Y(v)]; });
        if (kind === 'area') {
          var loPts = l.lo.map(function (v, i) { return [X(i), Y(v)]; }).reverse();
          var ad = monotone(hiPts) + monotone(loPts, true) + 'Z';
          kids.push(h('path', { key: 'w' + si, d: ad, fill: col, fillOpacity: 0.05 }));
          kids.push(h('g', { key: 'a' + si, mask: 'url(#' + id + 'fm)' }, h('path', { d: ad, fill: col, mask: 'url(#' + id + 'dm)', shapeRendering: 'crispEdges' })));
        }
        kids.push(h('path', { key: 'l' + si, d: monotone(hiPts), fill: 'none', stroke: col, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }));
        if (kind === 'line' && n) {
          var ep = hiPts[n - 1];
          kids.push(h('rect', { key: 'e' + si, x: Math.round(ep[0]) - 3, y: Math.round(ep[1]) - 3, width: 6, height: 6, rx: 1, fill: col, stroke: '#fff', strokeWidth: 1.5 }));
        }
      });
      if (hv.idx !== null) {
        var curX = X(hv.idx);
        kids.push(h('line', { key: 'cur', className: 'gr-cursor', x1: curX, x2: curX, y1: top, y2: top + ih }));
        layers.forEach(function (l, si) {
          var dy = Math.round(Y(l.hi[hv.idx]));
          kids.push(h('rect', { key: 'dot' + si, x: Math.round(curX) - 4, y: dy - 4, width: 8, height: 8, rx: 1.5, fill: seriesColor(series[si], si), stroke: '#fff', strokeWidth: 2 }));
        });
      }
      kids.push(h('rect', {
        key: 'hit', x: left, y: top, width: iw, height: ih, fill: 'transparent',
        onPointerMove: function (e) {
          var r = e.currentTarget.getBoundingClientRect(), px = e.clientX - r.left;
          hv.setIdx(n < 2 ? 0 : Math.max(0, Math.min(n - 1, Math.round(px / (iw / (n - 1))))));
        },
        onPointerLeave: function () { hv.setIdx(null); }
      }));
    }
    var tipRows = hv.idx === null ? [] : series.map(function (s, si) {
      return { color: seriesColor(s, si), label: s.label || s.key, value: fmt(+data[hv.idx][s.key] || 0) };
    }).reverse();
    if (!stacked) tipRows.reverse();
    return h('div', { className: cx('gr-chart', props.className) },
      h('div', {
        ref: ref, className: 'gr-chart-plot', tabIndex: 0, role: 'img',
        'aria-label': props.ariaLabel || ((kind === 'area' ? '面积图' : '折线图') + '：' + series.map(function (s) { return s.label || s.key; }).join('、')),
        onKeyDown: hv.onKey, onBlur: function () { hv.setIdx(null); }
      },
        h('svg', { width: W, height: H, viewBox: '0 0 ' + (W || 1) + ' ' + H, 'aria-hidden': true }, kids),
        h(Tip, { open: hv.idx !== null && W > 0, x: hv.idx === null ? 0 : X(hv.idx), y: top, width: W, title: hv.idx === null ? null : data[hv.idx][xKey], rows: tipRows })),
      h(Legend, { kind: kind === 'line' ? 'line' : 'swatch', items: series.map(function (s, si) { return { label: s.label || s.key, color: seriesColor(s, si) }; }) }),
      h(SrTable, { head: props.xLabel || '', cols: series.map(function (s) { return s.label || s.key; }), rows: data.map(function (d) { return [d[xKey]].concat(series.map(function (s) { return fmt(+d[s.key] || 0); })); }) }));
  }
  function AreaChart(props) { return XY(props, 'area'); }
  function LineChart(props) { return XY(props, 'line'); }

  // ---------- bars ----------
  function topRounded(x, y, w, hgt, r) {
    if (hgt <= 0) return '';
    r = Math.min(r, w / 2, hgt);
    return 'M' + x + ' ' + (y + hgt) + 'V' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + r) + 'V' + (y + hgt) + 'Z';
  }
  function BarChart(props) {
    var data = props.data || [], series = props.series || [], xKey = props.xKey || 'label';
    var H = props.height || 240, fmt = props.valueFormat || fmtFull, stacked = !!props.stacked;
    var ref = React.useRef(null), W = useWidth(ref), hv = useHover(data.length), bid = useChartId();
    var yAxis = props.yAxis !== false;
    var top = 12, bottom = 28, right = 8, left = yAxis ? 44 : 8;
    var iw = Math.max(0, W - left - right), ih = H - top - bottom, n = data.length, k = series.length;
    var max = 0;
    data.forEach(function (d) {
      var sum = 0; series.forEach(function (s) { var v = +d[s.key] || 0; sum += v; if (!stacked && v > max) max = v; });
      if (stacked && sum > max) max = sum;
    });
    var ticks = niceTicks(max, 4), tmax = ticks[ticks.length - 1];
    function Y(v) { return top + ih * (1 - v / tmax); }
    var band = n ? iw / n : 0, gap = 2;
    var bw = stacked ? Math.min(props.barSize || 24, band * 0.6) : Math.min(props.barSize || 24, (band * 0.7 - gap * (k - 1)) / Math.max(k, 1));
    var groupW = stacked ? bw : bw * k + gap * (k - 1);
    var every = Math.max(1, Math.ceil(n * 40 / Math.max(iw, 1)));
    var kids = [];
    if (W > 0) {
      kids.push(h('g', { key: 'grid', className: 'gr-grid' }, ticks.map(function (t, i) {
        return h('line', { key: i, x1: left, x2: left + iw, y1: Math.round(Y(t)) + 0.5, y2: Math.round(Y(t)) + 0.5 });
      })));
      if (yAxis) kids.push(h('g', { key: 'ya', className: 'gr-axis' }, ticks.map(function (t, i) {
        return h('text', { key: i, x: left - 10, y: Y(t), dy: '0.32em', textAnchor: 'end' }, fmtAxis(t, tmax));
      })));
      var base0 = Math.round(Y(0)), bars = [];
      kids.push(h('defs', { key: 'bd' },
        h('pattern', { id: bid + 'sp', width: 4, height: 4, patternUnits: 'userSpaceOnUse', patternTransform: 'translate(0 ' + base0 + ')' },
          h('rect', { x: 0, y: 0, width: 2, height: 2, fill: '#fff' }),
          h('rect', { x: 2, y: 2, width: 2, height: 2, fill: '#fff' })),
        h('mask', { id: bid + 'sm', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H },
          h('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#' + bid + 'sp)' }))));
      if (hv.idx !== null) kids.push(h('rect', { key: 'band', className: 'gr-band', x: left + hv.idx * band + 2, y: top, width: band - 4, height: ih, rx: 8 }));
      var labels = [];
      data.forEach(function (d, i) {
        var gx = left + i * band + (band - groupW) / 2, acc = 0, dim = hv.idx !== null && hv.idx !== i;
        var lastNonZero = -1;
        series.forEach(function (s, si) { if ((+d[s.key] || 0) > 0) lastNonZero = si; });
        series.forEach(function (s, si) {
          var v = +d[s.key] || 0; if (v <= 0) return;
          var x, y0, y1;
          if (stacked) { x = gx; y1 = Y(acc + v); y0 = Y(acc); acc += v; }
          else { x = gx + si * (bw + gap); y1 = Y(v); y0 = Y(0); }
          // a solid pixel cap on a dithered body: light, and still reads as a bar
          x = Math.round(x); y1 = Math.round(y1); y0 = Math.round(y0);
          var bh = Math.max(0, y0 - y1), cap = Math.min(4, bh), col = seriesColor(s, si), bwr = Math.round(bw);
          bars.push(h('g', { key: i + '-' + si, opacity: dim ? 0.4 : 1, style: { transition: 'opacity .2s ease-out' } },
            h('rect', { x: x, y: y1, width: bwr, height: bh, fill: col, fillOpacity: 0.08 }),
            h('rect', { x: x, y: y1 + cap, width: bwr, height: bh - cap, fill: col, fillOpacity: 0.7, mask: 'url(#' + bid + 'sm)' }),
            h('rect', { x: x, y: y1, width: bwr, height: cap, fill: col })));
        });
        if (!(i % every && i !== n - 1)) labels.push(h('text', { key: 'x' + i, className: 'gr-axis-t', x: left + i * band + band / 2, y: H - 8, textAnchor: 'middle' }, d[xKey]));
      });
      kids.push(h('g', { key: 'bars', shapeRendering: 'crispEdges' }, bars));
      kids.push(h('g', { key: 'xl' }, labels));
      kids.push(h('rect', {
        key: 'hit', x: left, y: top, width: iw, height: ih, fill: 'transparent',
        onPointerMove: function (e) {
          var r = e.currentTarget.getBoundingClientRect();
          hv.setIdx(Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left) / band))));
        },
        onPointerLeave: function () { hv.setIdx(null); }
      }));
    }
    var tipRows = hv.idx === null ? [] : series.map(function (s, si) {
      return { color: seriesColor(s, si), label: s.label || s.key, value: fmt(+data[hv.idx][s.key] || 0) };
    });
    if (stacked) tipRows.reverse();
    return h('div', { className: cx('gr-chart', props.className) },
      h('div', {
        ref: ref, className: 'gr-chart-plot', tabIndex: 0, role: 'img',
        'aria-label': props.ariaLabel || ('柱状图：' + series.map(function (s) { return s.label || s.key; }).join('、')),
        onKeyDown: hv.onKey, onBlur: function () { hv.setIdx(null); }
      },
        h('svg', { width: W, height: H, viewBox: '0 0 ' + (W || 1) + ' ' + H, 'aria-hidden': true }, kids),
        h(Tip, { open: hv.idx !== null && W > 0, x: hv.idx === null ? 0 : left + hv.idx * band + band / 2 + groupW / 2, y: top, width: W, title: hv.idx === null ? null : data[hv.idx][xKey], rows: tipRows })),
      h(Legend, { items: series.map(function (s, si) { return { label: s.label || s.key, color: seriesColor(s, si) }; }) }),
      h(SrTable, { head: props.xLabel || '', cols: series.map(function (s) { return s.label || s.key; }), rows: data.map(function (d) { return [d[xKey]].concat(series.map(function (s) { return fmt(+d[s.key] || 0); })); }) }));
  }

  // ---------- arcs ----------
  function polar(cx, cy, r, a) { return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; }
  function arcPath(cx, cy, r0, r1, a0, a1) {
    var large = a1 - a0 > Math.PI ? 1 : 0;
    var p0 = polar(cx, cy, r1, a0), p1 = polar(cx, cy, r1, a1), p2 = polar(cx, cy, r0, a1), p3 = polar(cx, cy, r0, a0);
    return 'M' + p0 + 'A' + r1 + ' ' + r1 + ' 0 ' + large + ' 1 ' + p1 + 'L' + p2 + 'A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + p3 + 'Z';
  }
  function DonutChart(props) {
    var data = props.data || [], fmt = props.valueFormat || fmtFull, size = props.size || 200;
    var st = React.useState(null), hi = st[0], setHi = st[1];
    var ref = React.useRef(null), W = useWidth(ref), did = useChartId();
    var total = data.reduce(function (a, d) { return a + (+d.value || 0); }, 0);
    var cx = size / 2, cy = size / 2, r1 = size / 2 - 6, r0 = r1 * 0.64, pad = 2 / ((r0 + r1) / 2);
    var a = 0, segs = [], rm = (r0 + r1) / 2, blk = 16 / rm, gp = 2 / rm;
    data.forEach(function (d, i) {
      var v = +d.value || 0; if (v <= 0 || !total) return;
      var span = v / total * Math.PI * 2, on = hi === i, a0 = a + gp, a1 = a + span;
      var nb = Math.max(1, Math.round((a1 - a0 + gp) / (blk + gp))), step = (a1 - a0 + gp) / nb, parts = [];
      for (var b = 0; b < nb; b++) {
        var s0 = a0 + b * step, s1 = s0 + step - gp;
        var ro = on ? r1 + 4 : r1, e1 = Math.max(s0 + 0.001, s1), body = arcPath(cx, cy, r0, ro - 4, s0, e1);
        parts.push(h('g', { key: b },
          h('path', { d: arcPath(cx, cy, r0, ro, s0, e1), fillOpacity: 0.08 }),
          h('path', { d: body, fillOpacity: on ? 1 : 0.7, mask: on ? null : 'url(#' + did + 'm)' }),
          h('path', { d: arcPath(cx, cy, ro - 4, ro, s0, e1) })));
      }
      segs.push(h('g', {
        key: i, fill: seriesColor(d, i), opacity: hi !== null && !on ? 0.4 : 1, style: { transition: 'opacity .2s ease-out' },
        onPointerEnter: function () { setHi(i); }, onPointerLeave: function () { setHi(null); }
      }, parts));
      a += span;
    });
    function onKey(e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { setHi(hi === null ? 0 : (hi + 1) % data.length); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { setHi(hi === null ? data.length - 1 : (hi - 1 + data.length) % data.length); e.preventDefault(); }
      else if (e.key === 'Escape') setHi(null);
    }
    var shown = hi === null ? null : data[hi];
    return h('div', { className: cx_('gr-chart', props.className) },
      h('div', { ref: ref, className: 'gr-chart-plot', tabIndex: 0, role: 'img', style: { height: size },
        'aria-label': props.ariaLabel || ('环形图：' + data.map(function (d) { return d.label + ' ' + fmt(+d.value || 0); }).join('，')),
        onKeyDown: onKey, onBlur: function () { setHi(null); } },
        h('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, style: { display: 'block', margin: '0 auto', overflow: 'visible' }, 'aria-hidden': true },
          h('defs', null,
            h('pattern', { id: did + 'p', width: 4, height: 4, patternUnits: 'userSpaceOnUse' },
              h('rect', { x: 0, y: 0, width: 2, height: 2, fill: '#fff' }),
              h('rect', { x: 2, y: 2, width: 2, height: 2, fill: '#fff' })),
            h('mask', { id: did + 'm', maskUnits: 'userSpaceOnUse', x: -8, y: -8, width: size + 16, height: size + 16 },
              h('rect', { x: -8, y: -8, width: size + 16, height: size + 16, fill: 'url(#' + did + 'p)' }))),
          segs,
          h('text', { className: 'gr-donut-value', x: cx, y: cy - 2, textAnchor: 'middle' }, shown ? fmt(+shown.value || 0) : (props.centerValue != null ? props.centerValue : fmt(total))),
          h('text', { className: 'gr-donut-label', x: cx, y: cy + 20, textAnchor: 'middle' }, shown ? shown.label + (total ? ' · ' + Math.round(shown.value / total * 100) + '%' : '') : (props.centerLabel || '合计')))),
      h(Legend, { items: data.map(function (d, i) { return { label: d.label, color: seriesColor(d, i) }; }) }),
      h(SrTable, { head: '项目', cols: ['数值', '占比'], rows: data.map(function (d) { return [d.label, fmt(+d.value || 0), total ? Math.round(d.value / total * 100) + '%' : '0%']; }) }));
  }
  function RadialChart(props) {
    var data = props.data || [], size = props.size || 200, thick = props.thickness || 12, gap = 6;
    var fmt = props.valueFormat || function (v, max) { return Math.round(v / max * 100) + '%'; };
    var cxy = size / 2, rings = [];
    data.forEach(function (d, i) {
      var r = size / 2 - thick / 2 - 2 - i * (thick + gap); if (r <= thick) return;
      var frac = Math.max(0, Math.min(1, (+d.value || 0) / (+d.max || 100))), col = seriesColor(d, i);
      var circ = 2 * Math.PI * r, nb = Math.max(12, Math.round(circ / 14)), step = circ / nb, on = Math.round(frac * nb), dash = [];
      for (var b = 0; b < on; b++) dash.push(step - 2.5, 2.5);
      dash.push(0, circ);
      rings.push(h('circle', { key: 't' + i, cx: cxy, cy: cxy, r: r, fill: 'none', stroke: col, strokeOpacity: 0.12, strokeWidth: thick }));
      if (on) rings.push(h('circle', { key: 'v' + i, cx: cxy, cy: cxy, r: r, fill: 'none', stroke: col, strokeWidth: thick, strokeDasharray: dash.join(' '), transform: 'rotate(-90 ' + cxy + ' ' + cxy + ')' }));
    });
    var lead = data[0];
    return h('div', { className: cx_('gr-chart', props.className) },
      h('div', { className: 'gr-chart-plot', role: 'img', style: { height: size },
        'aria-label': props.ariaLabel || data.map(function (d) { return d.label + ' ' + fmt(+d.value || 0, +d.max || 100); }).join('，') },
        h('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, style: { display: 'block', margin: '0 auto' }, 'aria-hidden': true },
          rings,
          lead ? h('text', { className: 'gr-donut-value', x: cxy, y: cxy - 2, textAnchor: 'middle' }, props.centerValue != null ? props.centerValue : fmt(+lead.value || 0, +lead.max || 100)) : null,
          lead ? h('text', { className: 'gr-donut-label', x: cxy, y: cxy + 20, textAnchor: 'middle' }, props.centerLabel || lead.label) : null)),
      h(Legend, { items: data.map(function (d, i) { return { label: d.label, color: seriesColor(d, i) }; }) }));
  }
  var cx_ = cx;

  // ---------- the card every chart sits in ----------
  function ChartCard(props) {
    var t = props.trend;
    var rest = omit(props, ['title', 'description', 'action', 'trend', 'footer', 'className', 'children']);
    rest.className = cx('gr-chartcard', props.className);
    return h('section', rest,
      h('div', { className: 'gr-chartcard-head' },
        h('div', { className: 'gr-chartcard-titles' },
          props.title ? h('h3', { className: 'gr-chartcard-title' }, props.title) : null,
          props.description ? h('p', { className: 'gr-chartcard-desc' }, props.description) : null),
        props.action ? h('div', { className: 'gr-chartcard-action' }, props.action) : null),
      h('div', { className: 'gr-chartcard-body' }, props.children),
      (t || props.footer) ? h('div', { className: 'gr-chartcard-foot' },
        t ? h('p', { className: 'gr-trend' },
          h('span', null, t.text),
          h('span', { className: cx('gr-trend-icon', t.good === false ? 'gr-trend-bad' : t.good === true ? 'gr-trend-good' : null) }, glyph(t.direction === 'down' ? 'trending-down' : 'trending-up', 16))) : null,
        props.footer ? h('p', { className: 'gr-chartcard-note' }, props.footer) : null) : null);
  }

  // ======================================================================
  // Forms, data display and overlays
  // ======================================================================
  function useControlled(value, defaultValue, onChange) {
    var st = React.useState(defaultValue);
    var controlled = value !== undefined;
    return [controlled ? value : st[0], function (v) { if (!controlled) st[1](v); if (onChange) onChange(v); }];
  }
  function useStableId(prefix, given) {
    var r = React.useRef(null);
    if (r.current === null) r.current = given || (prefix + (++uid));
    return r.current;
  }
  function useOutside(ref, open, close) {
    React.useEffect(function () {
      if (!open) return;
      function onDown(e) { if (ref.current && !ref.current.contains(e.target)) close(); }
      function onKey(e) { if (e.key === 'Escape') close(); }
      document.addEventListener('pointerdown', onDown);
      document.addEventListener('keydown', onKey);
      return function () { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
    }, [open]);
  }
  function ico(name, size, sw) { return glyph(name, size || 16, sw); }
  var I_CHECK = 'check', I_DASH = 'minus', I_CHEVRON = 'chevron-down', I_CLOSE = 'x';

  // ---------- Checkbox ----------
  function Checkbox(props) {
    var c = useControlled(props.checked, !!props.defaultChecked, props.onChange), on = c[0];
    var id = useStableId('gr-cb-', props.id);
    var mixed = !!props.indeterminate;
    return h('div', { className: cx('gr-check', props.disabled && 'gr-check-disabled', props.className) },
      h('button', {
        id: id, type: 'button', role: 'checkbox', 'aria-checked': mixed ? 'mixed' : on, disabled: props.disabled,
        'aria-describedby': props.description ? id + '-d' : undefined,
        className: cx('gr-check-box', (on || mixed) && 'gr-check-on'),
        onClick: function () { c[1](!on); }
      }, (on || mixed) ? ico(mixed ? I_DASH : I_CHECK, 14, 3) : null),
      (props.label || props.description) ? h('div', { className: 'gr-check-text' },
        props.label ? h('label', { htmlFor: id, className: 'gr-check-label' }, props.label) : null,
        props.description ? h('p', { id: id + '-d', className: 'gr-check-desc' }, props.description) : null) : null);
  }

  // ---------- RadioGroup ----------
  function RadioGroup(props) {
    var items = props.items || [];
    var c = useControlled(props.value, props.defaultValue, props.onChange), cur = c[0];
    var gid = useStableId('gr-rg-', props.id);
    function move(i, dir) {
      for (var k = 1; k <= items.length; k++) {
        var j = (i + dir * k + items.length) % items.length;
        if (!items[j].disabled) { c[1](items[j].value); var el = document.getElementById(gid + '-' + j); if (el) el.focus(); return; }
      }
    }
    return h('div', { className: cx('gr-radios', props.className), role: 'radiogroup', 'aria-labelledby': props.label ? gid + '-l' : undefined },
      props.label ? h('p', { id: gid + '-l', className: 'gr-label' }, props.label) : null,
      items.map(function (it, i) {
        var on = it.value === cur, focusable = on || (cur === undefined && i === 0);
        return h('div', { key: it.value, className: cx('gr-check', it.disabled && 'gr-check-disabled') },
          h('button', {
            id: gid + '-' + i, type: 'button', role: 'radio', 'aria-checked': on, disabled: it.disabled, tabIndex: focusable ? 0 : -1,
            className: cx('gr-radio', on && 'gr-radio-on'),
            onClick: function () { c[1](it.value); },
            onKeyDown: function (e) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { move(i, 1); e.preventDefault(); }
              if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { move(i, -1); e.preventDefault(); }
            }
          }, h('span', { className: 'gr-radio-dot' })),
          h('div', { className: 'gr-check-text' },
            h('label', { htmlFor: gid + '-' + i, className: 'gr-check-label' }, it.label),
            it.description ? h('p', { className: 'gr-check-desc' }, it.description) : null));
      }));
  }

  // ---------- Select ----------
  function Select(props) {
    var options = props.options || [];
    var c = useControlled(props.value, props.defaultValue, props.onChange), cur = c[0];
    var o = React.useState(!!props.defaultOpen), open = o[0], setOpen = o[1];
    var a = React.useState(-1), active = a[0], setActive = a[1];
    var ref = React.useRef(null), id = useStableId('gr-sel-', props.id);
    useOutside(ref, open, function () { setOpen(false); });
    var idx = -1; options.forEach(function (op, i) { if (op.value === cur) idx = i; });
    function show() { setOpen(true); setActive(idx < 0 ? 0 : idx); }
    function pick(i) { var op = options[i]; if (!op || op.disabled) return; c[1](op.value); setOpen(false); }
    function onKey(e) {
      if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { show(); e.preventDefault(); return; }
      if (!open) return;
      if (e.key === 'ArrowDown') { setActive(Math.min(options.length - 1, active + 1)); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { setActive(Math.max(0, active - 1)); e.preventDefault(); }
      else if (e.key === 'Enter' || e.key === ' ') { pick(active); e.preventDefault(); }
      else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
    }
    return h('div', { ref: ref, className: cx('gr-field gr-select', props.className) },
      props.label ? h('label', { className: 'gr-label', htmlFor: id }, props.label) : null,
      h('button', {
        id: id, type: 'button', className: cx('gr-select-trigger', open && 'gr-select-open'), disabled: props.disabled,
        'aria-haspopup': 'listbox', 'aria-expanded': open, 'aria-controls': id + '-list',
        onClick: function () { open ? setOpen(false) : show(); }, onKeyDown: onKey
      },
        h('span', { className: idx < 0 ? 'gr-select-placeholder' : null }, idx < 0 ? (props.placeholder || '请选择') : options[idx].label),
        h('span', { className: 'gr-select-chevron' }, ico(I_CHEVRON, 16))),
      open ? h('ul', { id: id + '-list', role: 'listbox', className: 'gr-pop gr-select-list', 'aria-activedescendant': active >= 0 ? id + '-o' + active : undefined },
        options.map(function (op, i) {
          var on = op.value === cur;
          return h('li', {
            key: op.value, id: id + '-o' + i, role: 'option', 'aria-selected': on, 'aria-disabled': op.disabled || undefined,
            className: cx('gr-option', i === active && 'gr-option-active', op.disabled && 'gr-option-disabled'),
            onPointerEnter: function () { setActive(i); }, onClick: function () { pick(i); }
          }, h('span', null, op.label), on ? h('span', { className: 'gr-option-check' }, ico(I_CHECK, 14)) : null);
        })) : null,
      props.hint ? h('p', { className: 'gr-msg' }, props.hint) : null);
  }

  // ---------- Textarea ----------
  function Textarea(props) {
    var id = useStableId('gr-ta-', props.id);
    var c = useControlled(props.value, props.defaultValue || '', props.onChange ? function (v) { props.onChange(v); } : null);
    var rest = omit(props, ['label', 'hint', 'error', 'className', 'id', 'value', 'defaultValue', 'onChange']);
    rest.id = id; rest.value = c[0];
    rest.onChange = function (e) { c[1](e.target.value); };
    rest.className = cx('gr-input gr-textarea', props.error && 'gr-input-invalid');
    rest.rows = props.rows || 4;
    if (props.error) rest['aria-invalid'] = true;
    if (props.hint || props.error) rest['aria-describedby'] = id + '-msg';
    var count = props.maxLength ? h('span', { className: 'gr-count' }, (c[0] || '').length + ' / ' + props.maxLength) : null;
    return h('div', { className: cx('gr-field', props.className) },
      props.label ? h('label', { className: 'gr-label', htmlFor: id }, props.label) : null,
      h('textarea', rest),
      (props.error || props.hint || count) ? h('div', { className: 'gr-msg-row' },
        props.error ? h('p', { id: id + '-msg', className: 'gr-msg gr-msg-error' }, props.error)
          : props.hint ? h('p', { id: id + '-msg', className: 'gr-msg' }, props.hint) : h('span'),
        count) : null);
  }

  // ---------- Slider ----------
  function Slider(props) {
    var min = props.min != null ? props.min : 0, max = props.max != null ? props.max : 100;
    var c = useControlled(props.value, props.defaultValue != null ? props.defaultValue : min, props.onChange), v = c[0];
    var id = useStableId('gr-sl-', props.id);
    var fmt = props.format || function (x) { return String(x); };
    var pct = (v - min) / (max - min) * 100;
    return h('div', { className: cx('gr-field gr-slider', props.disabled && 'gr-slider-disabled', props.className) },
      (props.label || props.showValue !== false) ? h('div', { className: 'gr-slider-head' },
        props.label ? h('label', { className: 'gr-label', htmlFor: id }, props.label) : h('span'),
        props.showValue !== false ? h('span', { className: 'gr-slider-value' }, fmt(v)) : null) : null,
      h('input', {
        id: id, type: 'range', min: min, max: max, step: props.step || 1, value: v, disabled: props.disabled,
        'aria-valuetext': fmt(v), className: 'gr-range', style: { '--p': pct + '%' },
        onChange: function (e) { c[1](+e.target.value); }
      }));
  }

  // ---------- Progress: lit pixel blocks ----------
  function Progress(props) {
    var max = props.max || 100, v = Math.max(0, Math.min(max, +props.value || 0)), pct = v / max * 100;
    var tone = props.tone || 'brand';
    var label = props.format ? props.format(v, max) : Math.round(pct) + '%';
    return h('div', { className: cx('gr-progress', 'gr-progress-' + tone, props.className) },
      (props.label || props.showValue !== false) ? h('div', { className: 'gr-progress-head' },
        props.label ? h('span', { className: 'gr-progress-label' }, props.label) : h('span'),
        props.showValue !== false ? h('span', { className: 'gr-progress-value' }, label) : null) : null,
      h('div', { className: 'gr-progress-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': v, 'aria-valuetext': label, 'aria-label': typeof props.label === 'string' ? props.label : undefined },
        h('div', { className: 'gr-progress-fill', style: { width: pct + '%' } })));
  }

  // ---------- Avatar ----------
  function initials(name, size) {
    if (!name) return '';
    var s = String(name).trim();
    if (/[\u4e00-\u9fff]/.test(s)) return size === 'sm' ? s.charAt(0) : (s.length > 2 ? s.slice(-2) : s);
    var parts = s.split(/\s+/);
    return ((parts[0] || '')[0] + ((parts[1] || '')[0] || '')).toUpperCase();
  }
  function Avatar(props) {
    var size = props.size || 'md';
    var e = React.useState(false), broken = e[0], setBroken = e[1];
    return h('span', { className: cx('gr-avatar', 'gr-avatar-' + size, props.className), title: props.name, role: 'img', 'aria-label': props.name },
      props.src && !broken ? h('img', { src: props.src, alt: '', onError: function () { setBroken(true); } }) : h('span', { 'aria-hidden': true }, initials(props.name, props.compact ? 'sm' : size)),
      props.status ? h('span', { className: 'gr-avatar-status gr-avatar-' + props.status, 'aria-hidden': true }) : null);
  }
  function AvatarGroup(props) {
    var list = props.people || [], max = props.max || 4, extra = list.length - max;
    return h('div', { className: cx('gr-avatar-group', props.className) },
      list.slice(0, max).map(function (p, i) { return h(Avatar, { key: i, name: p.name, src: p.src, size: props.size, compact: true }); }),
      extra > 0 ? h('span', { className: cx('gr-avatar', 'gr-avatar-' + (props.size || 'md'), 'gr-avatar-more'), 'aria-label': '另外 ' + extra + ' 人' }, '+' + extra) : null);
  }

  // ---------- Table ----------
  function Table(props) {
    var cols = props.columns || [], rows = props.rows || [];
    return h('div', { className: cx('gr-table-wrap', props.className) },
      h('table', { className: 'gr-table' },
        props.caption ? h('caption', { className: 'gr-sr' }, props.caption) : null,
        h('thead', null, h('tr', null, cols.map(function (c) {
          return h('th', { key: c.key, scope: 'col', style: { textAlign: c.align || 'left', width: c.width } }, c.header);
        }))),
        h('tbody', null, rows.length ? rows.map(function (r, i) {
          return h('tr', { key: r.id != null ? r.id : i }, cols.map(function (c) {
            return h('td', { key: c.key, style: { textAlign: c.align || 'left' }, className: c.numeric ? 'gr-num' : null }, c.render ? c.render(r) : r[c.key]);
          }));
        }) : h('tr', null, h('td', { colSpan: cols.length, className: 'gr-table-empty' }, props.empty || '暂无数据')))));
  }

  // ---------- StatCard: a KPI with a dithered sparkline ----------
  function Sparkline(props) {
    var data = props.data || [], w = props.width || 100, hgt = props.height || 36, sid = useChartId();
    if (data.length < 2) return null;
    var mn = Math.min.apply(null, data), mx = Math.max.apply(null, data), span = mx - mn || 1;
    var pts = data.map(function (v, i) { return [i * (w - 4) / (data.length - 1) + 2, 3 + (hgt - 6) * (1 - (v - mn) / span)]; });
    var line = monotone(pts), col = props.color || 'var(--chart-1)', last = pts[pts.length - 1];
    return h('svg', { className: 'gr-spark', width: w, height: hgt, viewBox: '0 0 ' + w + ' ' + hgt, 'aria-hidden': true },
      h('defs', null,
        h('pattern', { id: sid + 'p', width: 4, height: 4, patternUnits: 'userSpaceOnUse' },
          h('rect', { x: 0, y: 0, width: 2, height: 2, fill: '#fff' }), h('rect', { x: 2, y: 2, width: 2, height: 2, fill: '#fff' })),
        h('linearGradient', { id: sid + 'g', x1: 0, y1: 0, x2: 0, y2: 1 },
          h('stop', { offset: '0%', stopColor: '#fff', stopOpacity: 0.6 }), h('stop', { offset: '100%', stopColor: '#fff', stopOpacity: 0 })),
        h('mask', { id: sid + 'm', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: w, height: hgt },
          h('rect', { width: w, height: hgt, fill: 'url(#' + sid + 'p)' })),
        h('mask', { id: sid + 'f', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: w, height: hgt },
          h('rect', { width: w, height: hgt, fill: 'url(#' + sid + 'g)' }))),
      h('g', { mask: 'url(#' + sid + 'f)' }, h('path', { d: line + 'L' + last[0] + ' ' + hgt + 'L' + pts[0][0] + ' ' + hgt + 'Z', fill: col, mask: 'url(#' + sid + 'm)', shapeRendering: 'crispEdges' })),
      h('path', { d: line, fill: 'none', stroke: col, strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      h('rect', { x: Math.round(last[0]) - 3, y: Math.round(last[1]) - 3, width: 6, height: 6, rx: 1, fill: col, stroke: '#fff', strokeWidth: 1.5 }));
  }
  function StatCard(props) {
    var d = props.delta;
    var rest = omit(props, ['label', 'value', 'delta', 'trend', 'note', 'className', 'children']);
    rest.className = cx('gr-chartcard gr-stat', props.className);
    return h('section', rest,
      h('p', { className: 'gr-stat-label' }, props.label),
      h('div', { className: 'gr-stat-row' },
        h('p', { className: 'gr-stat-value' }, props.value),
        props.trend ? h(Sparkline, { data: props.trend }) : null),
      (d || props.note) ? h('p', { className: 'gr-stat-foot' },
        d ? h('span', { className: cx('gr-stat-delta', d.good === true ? 'gr-trend-good' : d.good === false ? 'gr-trend-bad' : null) },
          ico(d.direction === 'down' ? 'arrow-down' : 'arrow-up', 13), d.text) : null,
        props.note ? h('span', { className: 'gr-stat-note' }, props.note) : null) : null);
  }

  // ---------- Tooltip ----------
  function Tooltip(props) {
    var o = React.useState(!!props.defaultOpen), open = o[0], setOpen = o[1];
    var id = useStableId('gr-tt-');
    var child = React.Children.only(props.children);
    var trigger = React.cloneElement(child, { 'aria-describedby': id });
    return h('span', {
      className: cx('gr-tooltip-anchor', props.className),
      onPointerEnter: function () { setOpen(true); }, onPointerLeave: function () { setOpen(false); },
      onFocus: function () { setOpen(true); }, onBlur: function () { setOpen(false); },
      onKeyDown: function (e) { if (e.key === 'Escape') setOpen(false); }
    }, trigger,
      h('span', { id: id, role: 'tooltip', className: cx('gr-tooltip', 'gr-tooltip-' + (props.side || 'top'), open && 'gr-tooltip-open') }, props.content));
  }

  // ---------- Dialog ----------
  function Dialog(props) {
    var id = useStableId('gr-dlg-'), panel = React.useRef(null);
    React.useEffect(function () {
      if (!props.open) return;
      var prev = document.activeElement;
      var el = panel.current;
      var first = el && el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (first && !props.noAutoFocus) first.focus();
      function onKey(e) { if (e.key === 'Escape' && props.onClose) props.onClose(); }
      document.addEventListener('keydown', onKey);
      return function () { document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
    }, [props.open]);
    if (!props.open) return null;
    return h('div', { className: 'gr-dialog-layer', onPointerDown: function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); } },
      h('div', { ref: panel, className: cx('gr-dialog', props.className), role: 'dialog', 'aria-modal': true, 'aria-labelledby': id + '-t', 'aria-describedby': props.description ? id + '-d' : undefined, style: props.width ? { width: props.width } : null },
        props.onClose ? h('button', { type: 'button', className: 'gr-dialog-close', 'aria-label': '关闭', onClick: props.onClose }, ico(I_CLOSE, 16)) : null,
        h('h2', { id: id + '-t', className: 'gr-dialog-title' }, props.title),
        props.description ? h('p', { id: id + '-d', className: 'gr-dialog-desc' }, props.description) : null,
        props.children ? h('div', { className: 'gr-dialog-body' }, props.children) : null,
        props.footer ? h('div', { className: 'gr-dialog-foot' }, props.footer) : null));
  }

  // ---------- Menu (dropdown) ----------
  function Menu(props) {
    var items = props.items || [];
    var o = React.useState(!!props.defaultOpen), open = o[0], setOpen = o[1];
    var a = React.useState(-1), active = a[0], setActive = a[1];
    var ref = React.useRef(null), id = useStableId('gr-menu-');
    useOutside(ref, open, function () { setOpen(false); });
    var actionable = []; items.forEach(function (it, i) { if (!it.separator && !it.disabled) actionable.push(i); });
    function step(dir) {
      var pos = actionable.indexOf(active), next = pos < 0 ? (dir > 0 ? 0 : actionable.length - 1) : (pos + dir + actionable.length) % actionable.length;
      setActive(actionable[next]);
    }
    function choose(i) { var it = items[i]; if (!it || it.disabled || it.separator) return; setOpen(false); if (it.onSelect) it.onSelect(); }
    function onKey(e) {
      if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { setOpen(true); setActive(actionable[0]); e.preventDefault(); return; }
      if (!open) return;
      if (e.key === 'ArrowDown') { step(1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { step(-1); e.preventDefault(); }
      else if (e.key === 'Enter' || e.key === ' ') { choose(active); e.preventDefault(); }
      else if (e.key === 'Tab') setOpen(false);
    }
    return h('div', { ref: ref, className: cx('gr-menu', props.className) },
      h(Button, { variant: props.variant || 'glass', size: props.size || 'md', 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': id, onClick: function () { setOpen(!open); setActive(-1); }, onKeyDown: onKey },
        props.label, h('span', { className: 'gr-select-chevron' }, ico(I_CHEVRON, 14))),
      open ? h('ul', { id: id, role: 'menu', className: cx('gr-pop gr-menu-list', props.align === 'end' && 'gr-menu-end') },
        items.map(function (it, i) {
          if (it.separator) return h('li', { key: 's' + i, role: 'separator', className: 'gr-menu-sep' });
          return h('li', {
            key: i, role: 'menuitem', 'aria-disabled': it.disabled || undefined, tabIndex: -1,
            className: cx('gr-option', i === active && 'gr-option-active', it.danger && 'gr-option-danger', it.disabled && 'gr-option-disabled'),
            onPointerEnter: function () { setActive(i); }, onClick: function () { choose(i); }
          }, h('span', null, it.label), it.shortcut ? h('kbd', { className: 'gr-kbd' }, it.shortcut) : null);
        })) : null);
  }

  // ======================================================================
  // Content helpers: icon buttons, copy, steps, code, files
  // ======================================================================
  var I_COPY = 'copy', I_RETRY = 'rotate-cw', I_UP = 'thumbs-up', I_DOWNVOTE = 'thumbs-down', I_CLIP = 'paperclip', I_SEND = 'arrow-up', I_DOWN = 'arrow-down';

  // ---------- Spinner: a 3×3 pixel grid lighting in a loop ----------
  var LOADER_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
  function Spinner(props) {
    var cells = [];
    for (var i = 0; i < 9; i++) {
      var k = LOADER_ORDER.indexOf(i);
      cells.push(h('span', { key: i, className: cx('gr-loader-cell', i === 4 && 'gr-loader-core'), style: k >= 0 ? { animationDelay: (k * 0.11) + 's' } : null }));
    }
    return h('span', { className: cx('gr-loader', props.size === 'lg' && 'gr-loader-lg', props.className), role: 'status', 'aria-label': props.label || '加载中' },
      h('span', { className: 'gr-loader-grid', 'aria-hidden': true }, cells),
      props.label && props.showLabel ? h('span', { className: 'gr-shimmer' }, props.label) : null);
  }

  function IconButton(props) {
    var rest = omit(props, ['icon', 'label', 'active', 'className', 'flip']);
    rest.type = 'button'; rest['aria-label'] = props.label; rest.title = props.label;
    if (props.active !== undefined) rest['aria-pressed'] = !!props.active;
    rest.className = cx('gr-iconbtn', props.active && 'gr-iconbtn-on', props.className);
    return h('button', rest, h('span', { style: props.flip ? { display: 'inline-flex', transform: 'scale(1,-1)' } : { display: 'inline-flex' } }, ico(props.icon, 16)));
  }
  function useCopy(text) {
    var st = React.useState(false);
    function copy() {
      try { if (navigator.clipboard) navigator.clipboard.writeText(typeof text === 'function' ? text() : text); } catch (e) {}
      st[1](true); setTimeout(function () { st[1](false); }, 1600);
    }
    return [st[0], copy];
  }

  // ---------- TaskSteps: a vertical progress list ----------
  function TaskSteps(props) {
    var steps = props.steps || [];
    return h('ol', { className: cx('gr-steps', props.className) }, steps.map(function (s, i) {
      var status = s.status || 'pending';
      var mark = status === 'running' ? h(Spinner, { label: '进行中' })
        : status === 'done' ? h('span', { className: 'gr-stepmark-done' }, ico(I_CHECK, 12))
        : status === 'error' ? h('span', { className: 'gr-stepmark-error' }, ico(I_CLOSE, 12))
        : h('span', { className: 'gr-stepmark-hollow' });
      return h('li', { key: i, className: cx('gr-step', 'gr-step-' + status) },
        h('span', { className: 'gr-step-mark' }, mark),
        h('div', { className: 'gr-step-text' },
          h('p', { className: 'gr-step-title' }, s.title, h('span', { className: 'gr-sr' }, '（' + { done: '已完成', running: '进行中', pending: '未开始', error: '失败' }[status] + '）')),
          s.description ? h('p', { className: 'gr-step-desc' }, s.description) : null,
          s.children || null));
    }));
  }

  // ---------- CodeBlock with a tiny highlighter ----------
  var KW = /\b(const|let|var|function|return|if|else|for|while|import|from|export|default|new|class|extends|async|await|try|catch|throw|true|false|null|undefined|def|in|and|or|not|None|True|False|select|from|where|group|by|order|limit)\b/;
  function highlight(code) {
    var re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
    var out = [], last = 0, m, k = 0;
    while ((m = re.exec(code))) {
      if (m.index > last) out.push(code.slice(last, m.index));
      var cls = m[1] ? 'tk-c' : m[2] ? 'tk-s' : m[3] ? 'tk-n' : m[4] ? (KW.test(m[4]) ? 'tk-k' : 'tk-f') : (KW.test(m[5]) ? 'tk-k' : null);
      out.push(cls ? h('span', { key: k++, className: cls }, m[0]) : m[0]);
      last = re.lastIndex;
    }
    if (last < code.length) out.push(code.slice(last));
    return out;
  }
  function CodeBlock(props) {
    var code = props.code || '', c = useCopy(code);
    return h('div', { className: cx('gr-code', props.className) },
      h('div', { className: 'gr-code-head' },
        h('span', { className: 'gr-code-lang' }, props.filename || props.language || 'code'),
        h('button', { type: 'button', className: 'gr-code-copy', onClick: c[1] }, ico(c[0] ? I_CHECK : I_COPY, 14), c[0] ? '已复制' : '复制')),
      h('pre', { className: 'gr-code-pre' }, h('code', null, props.highlight === false ? code : highlight(code))));
  }

  // ---------- Attachments ----------
  // File icons: a folded page in the type's colour with a white Lucide glyph —
  // no letters, no trademarked app logos. Teams licensed to use official
  // product icons register them with setFileIcons({ docx: url, … }).
  var FILE_KIND = {
    pdf: { glyph: 'scroll-text', color: '#e5484d', label: 'PDF 文档' },
    doc: { glyph: 'align-left', color: '#2f6fdb', label: '文档' },
    sheet: { glyph: 'table', color: '#1f9255', label: '表格' },
    slide: { glyph: 'chart-pie', color: '#e2692f', label: '演示文稿' },
    image: { glyph: 'image', color: '#7a5af0', label: '图片' },
    video: { glyph: 'play', color: '#d23f8f', label: '视频' },
    audio: { glyph: 'music', color: '#0f9488', label: '音频' },
    archive: { glyph: 'package', color: '#a87a1e', label: '压缩包' },
    code: { glyph: 'code', color: '#3d4b63', label: '代码' },
    data: { glyph: 'braces', color: '#56657c', label: '数据' },
    other: { glyph: null, color: '#6f7d93', label: '文件' }
  };
  var FILE_ICON_OVERRIDES = {};
  function setFileIcons(map) { for (var k in map) FILE_ICON_OVERRIDES[k.toLowerCase()] = map[k]; }
  function FileIcon(props) {
    var size = props.size || 32, kindKey = props.kind || fileKind(props.name || '', props.type);
    var ext = (String(props.name || '').split('.').pop() || '').toLowerCase();
    var custom = props.src || FILE_ICON_OVERRIDES[ext] || FILE_ICON_OVERRIDES[kindKey];
    var k = FILE_KIND[kindKey] || FILE_KIND.other;
    var w = size * 0.8;
    if (custom) return h('img', { className: cx('gr-fileicon', props.className), src: custom, width: size, height: size, alt: '', style: { objectFit: 'contain' } });
    return h('svg', { className: cx('gr-fileicon', props.className), width: w, height: size, viewBox: '0 0 32 40', role: props.label ? 'img' : undefined, 'aria-label': props.label ? k.label : undefined, 'aria-hidden': props.label ? undefined : true },
      h('path', { d: 'M5 0h16.5L32 10.5V35a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5V5a5 5 0 0 1 5-5z', fill: k.color }),
      h('path', { d: 'M21.5 0v6.5a4 4 0 0 0 4 4H32z', fill: '#fff', fillOpacity: 0.38 }),
      h('path', { d: 'M5 .5h16.3', stroke: '#fff', strokeOpacity: 0.35, strokeWidth: 1 }),
      k.glyph ? h('svg', { x: 7, y: 15, width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' }, glyphNodes(k.glyph)) : null);
  }
  function fileKind(name, type) {
    var ext = (String(name).split('.').pop() || '').toLowerCase(), t = type || '';
    if (/^image\//.test(t) || /^(png|jpe?g|gif|webp|svg|heic|avif)$/.test(ext)) return 'image';
    if (/^video\//.test(t) || /^(mp4|mov|webm|mkv)$/.test(ext)) return 'video';
    if (/^audio\//.test(t) || /^(mp3|wav|m4a|flac|ogg)$/.test(ext)) return 'audio';
    if (ext === 'pdf') return 'pdf';
    if (/^(xlsx?|csv|numbers|tsv)$/.test(ext)) return 'sheet';
    if (/^(pptx?|key)$/.test(ext)) return 'slide';
    if (/^(docx?|pages|md|txt|rtf)$/.test(ext)) return 'doc';
    if (/^(json|xml|ya?ml|sql)$/.test(ext)) return 'data';
    if (/^(js|ts|tsx|jsx|py|go|rs|java|html|css|sh)$/.test(ext)) return 'code';
    if (/^(zip|rar|7z|tar|gz)$/.test(ext)) return 'archive';
    return 'other';
  }
  function fmtSize(b) { if (b == null) return ''; return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
  function Attachments(props) {
    var items = props.items || [];
    return h('ul', { className: cx('gr-files', props.className) }, items.map(function (f, i) {
      var kk = fileKind(f.name, f.type), kind = FILE_KIND[kk];
      return h('li', { key: f.id != null ? f.id : i, className: cx('gr-file', f.status === 'uploading' && 'gr-file-busy', f.status === 'error' && 'gr-file-error') },
        f.src && kk === 'image' ? h('img', { className: 'gr-file-thumb', src: f.src, alt: '' })
          : h('span', { className: 'gr-file-kind', title: kind.label }, h(FileIcon, { name: f.name, type: f.type, src: f.icon, size: 34 }),
              f.status === 'error' ? h('span', { className: 'gr-file-badge' }, glyph('triangle-alert', 11, 2.5)) : null),
        h('span', { className: 'gr-file-text' },
          h('span', { className: 'gr-file-name' }, f.name),
          h('span', { className: 'gr-file-size' }, f.status === 'uploading' ? '上传中…' : f.status === 'error' ? '上传失败' : fmtSize(f.size))),
        props.onRemove ? h('button', { type: 'button', className: 'gr-file-x', 'aria-label': '移除 ' + f.name, onClick: function () { props.onRemove(f, i); } }, ico(I_CLOSE, 12)) : null);
    }));
  }

  // ======================================================================
  // Navigation, disclosure, feedback, dates and power-user components
  // ======================================================================

  // ---------- Separator & Kbd ----------
  function Separator(props) {
    if (props.orientation === 'vertical') return h('span', { className: cx('gr-sep-v', props.className), role: 'separator', 'aria-orientation': 'vertical' });
    return props.label
      ? h('div', { className: cx('gr-sep gr-sep-label', props.className), role: 'separator' }, h('span', null, props.label))
      : h('div', { className: cx('gr-sep', props.className), role: 'separator' });
  }
  function Kbd(props) { return h('kbd', { className: cx('gr-kbdcap', props.className) }, props.children); }

  // ---------- Skeleton ----------
  function Skeleton(props) {
    if (props.lines) {
      var rows = [];
      for (var i = 0; i < props.lines; i++) rows.push(h('span', { key: i, className: 'gr-skel', style: { height: 12, width: i === props.lines - 1 ? '62%' : '100%' } }));
      return h('div', { className: cx('gr-skel-lines', props.className), 'aria-hidden': true }, rows);
    }
    return h('span', { className: cx('gr-skel', props.circle && 'gr-skel-circle', props.className), 'aria-hidden': true,
      style: { width: props.width, height: props.height || (props.circle ? props.width : 14), borderRadius: props.radius } });
  }

  // ---------- EmptyState ----------
  function EmptyState(props) {
    return h('div', { className: cx('gr-empty', props.className) },
      h('span', { className: 'gr-empty-icon' }, glyph(props.icon || 'inbox', 22)),
      h('p', { className: 'gr-empty-title' }, props.title),
      props.description ? h('p', { className: 'gr-empty-desc' }, props.description) : null,
      props.action ? h('div', { className: 'gr-empty-action' }, props.action) : null);
  }

  // ---------- Accordion ----------
  function Accordion(props) {
    var items = props.items || [], multiple = props.type === 'multiple';
    var init = props.defaultValue != null ? [].concat(props.defaultValue) : [];
    var st = React.useState(init), open = st[0], setOpen = st[1];
    var id = useStableId('gr-acc-');
    function toggle(v) {
      var on = open.indexOf(v) >= 0;
      setOpen(multiple ? (on ? open.filter(function (x) { return x !== v; }) : open.concat([v])) : (on ? [] : [v]));
    }
    return h('div', { className: cx('gr-accordion', props.className) }, items.map(function (it, i) {
      var on = open.indexOf(it.value) >= 0;
      return h('div', { key: it.value, className: cx('gr-acc-item', on && 'gr-acc-open') },
        h('h3', { className: 'gr-acc-h' },
          h('button', { type: 'button', id: id + '-b' + i, className: 'gr-acc-trigger', 'aria-expanded': on, 'aria-controls': id + '-p' + i, onClick: function () { toggle(it.value); } },
            h('span', null, it.title), h('span', { className: 'gr-acc-chev' }, glyph('chevron-down', 16)))),
        h('div', { id: id + '-p' + i, role: 'region', 'aria-labelledby': id + '-b' + i, className: 'gr-acc-panel', hidden: !on || undefined },
          h('div', { className: 'gr-acc-inner' }, h('div', { className: 'gr-acc-content' }, it.content))));
    }));
  }

  // ---------- Breadcrumb ----------
  function Breadcrumb(props) {
    var items = props.items || [];
    return h('nav', { className: cx('gr-crumbs', props.className), 'aria-label': '面包屑' },
      h('ol', null, items.map(function (it, i) {
        var last = i === items.length - 1;
        return h('li', { key: i },
          last ? h('span', { className: 'gr-crumb-current', 'aria-current': 'page' }, it.label)
            : h('a', { className: 'gr-crumb', href: it.href || '#', onClick: it.onClick }, it.label),
          last ? null : h('span', { className: 'gr-crumb-sep', 'aria-hidden': true }, glyph('chevron-right', 14)));
      })));
  }

  // ---------- Pagination ----------
  function pageList(cur, total) {
    if (total <= 7) { var a = []; for (var i = 1; i <= total; i++) a.push(i); return a; }
    if (cur <= 4) return [1, 2, 3, 4, 5, '…', total];
    if (cur >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '…', cur - 1, cur, cur + 1, '…', total];
  }
  function Pagination(props) {
    var total = props.total || 1;
    var c = useControlled(props.page, props.defaultPage || 1, props.onChange), cur = c[0];
    function go(p) { if (p >= 1 && p <= total && p !== cur) c[1](p); }
    return h('nav', { className: cx('gr-pager', props.className), 'aria-label': '分页' },
      h('button', { type: 'button', className: 'gr-page gr-page-nav', disabled: cur <= 1, 'aria-label': '上一页', onClick: function () { go(cur - 1); } }, glyph('chevron-left', 16)),
      pageList(cur, total).map(function (p, i) {
        return p === '…' ? h('span', { key: 'e' + i, className: 'gr-page-gap', 'aria-hidden': true }, glyph('ellipsis', 16))
          : h('button', { key: p, type: 'button', className: cx('gr-page', p === cur && 'gr-page-on'), 'aria-current': p === cur ? 'page' : undefined, onClick: function () { go(p); } }, p);
      }),
      h('button', { type: 'button', className: 'gr-page gr-page-nav', disabled: cur >= total, 'aria-label': '下一页', onClick: function () { go(cur + 1); } }, glyph('chevron-right', 16)));
  }

  // ---------- ToggleGroup ----------
  function ToggleGroup(props) {
    var items = props.items || [], multiple = props.type === 'multiple';
    var c = useControlled(props.value, props.defaultValue != null ? props.defaultValue : (multiple ? [] : null), props.onChange), cur = c[0];
    function isOn(v) { return multiple ? (cur || []).indexOf(v) >= 0 : cur === v; }
    function flip(v) { if (multiple) c[1](isOn(v) ? cur.filter(function (x) { return x !== v; }) : (cur || []).concat([v])); else c[1](isOn(v) && !props.required ? null : v); }
    return h('div', { className: cx('gr-toggles', props.className), role: 'group', 'aria-label': props.label },
      items.map(function (it) {
        var on = isOn(it.value);
        return h('button', { key: it.value, type: 'button', className: cx('gr-toggle', on && 'gr-toggle-on', !it.label && 'gr-toggle-icon'), 'aria-pressed': on, disabled: it.disabled, title: it.title || (typeof it.label === 'string' ? undefined : it.title), 'aria-label': it.label ? undefined : it.title, onClick: function () { flip(it.value); } },
          it.icon ? glyph(it.icon, 16) : null, it.label ? h('span', null, it.label) : null);
      }));
  }

  // ---------- Popover ----------
  function Popover(props) {
    var o = React.useState(!!props.defaultOpen), open = props.open !== undefined ? props.open : o[0];
    function set(v) { if (props.open === undefined) o[1](v); if (props.onOpenChange) props.onOpenChange(v); }
    var ref = React.useRef(null), id = useStableId('gr-pop-');
    useOutside(ref, open, function () { set(false); });
    var trigger = React.cloneElement(props.trigger, { 'aria-expanded': open, 'aria-controls': id, 'aria-haspopup': 'dialog', onClick: function (e) { if (props.trigger.props.onClick) props.trigger.props.onClick(e); set(!open); } });
    return h('div', { ref: ref, className: cx('gr-popover', props.className) }, trigger,
      open ? h('div', { id: id, role: 'dialog', 'aria-label': props.label, className: cx('gr-pop gr-popover-panel', props.align === 'end' && 'gr-pop-end'), style: props.width ? { width: props.width } : null },
        typeof props.children === 'function' ? props.children(function () { set(false); }) : props.children) : null);
  }

  // ---------- Sheet (side panel) ----------
  function useModalFocus(open, panel, onClose, noAutoFocus) {
    React.useEffect(function () {
      if (!open) return;
      var prev = document.activeElement, el = panel.current;
      var first = el && el.querySelector('input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])');
      if (first && !noAutoFocus) first.focus();
      function onKey(e) { if (e.key === 'Escape' && onClose) onClose(); }
      document.addEventListener('keydown', onKey);
      return function () { document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
    }, [open]);
  }
  function Sheet(props) {
    var panel = React.useRef(null), id = useStableId('gr-sh-'), side = props.side || 'right';
    useModalFocus(props.open, panel, props.onClose, props.noAutoFocus);
    if (!props.open) return null;
    return h('div', { className: 'gr-dialog-layer gr-sheet-layer gr-sheet-layer-' + side, onPointerDown: function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); } },
      h('div', { ref: panel, role: 'dialog', 'aria-modal': true, 'aria-labelledby': id + '-t', className: cx('gr-sheet', 'gr-sheet-' + side, props.className), style: props.width ? { width: props.width } : null },
        h('div', { className: 'gr-sheet-head' },
          h('div', null, h('h2', { id: id + '-t', className: 'gr-dialog-title' }, props.title), props.description ? h('p', { className: 'gr-dialog-desc' }, props.description) : null),
          props.onClose ? h('button', { type: 'button', className: 'gr-dialog-close gr-sheet-close', 'aria-label': '关闭', onClick: props.onClose }, glyph('x', 16)) : null),
        h('div', { className: 'gr-sheet-body' }, props.children),
        props.footer ? h('div', { className: 'gr-sheet-foot' }, props.footer) : null));
  }

  // ---------- Toast ----------
  var toastItems = [], toastSubs = [], toastSeq = 0;
  function toastEmit() { var snap = toastItems.slice(); toastSubs.forEach(function (f) { f(snap); }); }
  function toastDismiss(id) {
    toastItems = toastItems.map(function (t) { return t.id === id ? Object.assign({}, t, { leaving: true }) : t; }); toastEmit();
    setTimeout(function () { toastItems = toastItems.filter(function (t) { return t.id !== id; }); toastEmit(); }, 200);
  }
  function toast(opts) {
    var t = typeof opts === 'string' ? { title: opts } : Object.assign({}, opts);
    t.id = ++toastSeq; toastItems = toastItems.concat([t]).slice(-4); toastEmit();
    var d = t.duration === undefined ? 4000 : t.duration;
    if (d !== Infinity && d > 0) setTimeout(function () { toastDismiss(t.id); }, d);
    return t.id;
  }
  toast.dismiss = toastDismiss;
  var TOAST_ICON = { success: 'circle-check', warning: 'triangle-alert', danger: 'circle-x', info: 'info' };
  function Toaster(props) {
    var st = React.useState(toastItems.slice()), list = st[0];
    React.useEffect(function () { toastSubs.push(st[1]); return function () { toastSubs = toastSubs.filter(function (f) { return f !== st[1]; }); }; }, []);
    return h('div', { className: cx('gr-toaster', 'gr-toaster-' + (props.position || 'bottom-right'), props.inline && 'gr-toaster-inline'), role: 'region', 'aria-label': '通知', 'aria-live': 'polite' },
      list.map(function (t) {
        return h('div', { key: t.id, className: cx('gr-toast', t.tone && 'gr-toast-' + t.tone, t.leaving && 'gr-toast-leave'), role: t.tone === 'danger' ? 'alert' : 'status' },
          t.tone ? h('span', { className: 'gr-toast-icon' }, glyph(TOAST_ICON[t.tone], 18)) : null,
          h('div', { className: 'gr-toast-text' }, h('p', { className: 'gr-toast-title' }, t.title), t.description ? h('p', { className: 'gr-toast-desc' }, t.description) : null),
          t.action ? h('button', { type: 'button', className: 'gr-toast-action', onClick: function () { t.action.onClick && t.action.onClick(); toastDismiss(t.id); } }, t.action.label) : null,
          h('button', { type: 'button', className: 'gr-toast-x', 'aria-label': '关闭通知', onClick: function () { toastDismiss(t.id); } }, glyph('x', 14)));
      }));
  }

  // ---------- Calendar ----------
  var WEEK = ['一', '二', '三', '四', '五', '六', '日'];
  function day0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function sameDay(a, b) { return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
  function fmtDate(d, withYear) { return d ? (withYear ? d.getFullYear() + '年' : '') + (d.getMonth() + 1) + '月' + d.getDate() + '日' : ''; }
  function Calendar(props) {
    var range = props.mode === 'range';
    var c = useControlled(props.value, props.defaultValue || (range ? {} : null), props.onChange), val = c[0];
    var anchor = range ? (val && val.from) : val;
    var vm = React.useState(day0(anchor || props.today || new Date())), view = new Date(vm[0].getFullYear(), vm[0].getMonth(), 1);
    var fc = React.useState(day0(anchor || props.today || new Date())), focus = fc[0];
    var hv = React.useState(null), hover = hv[0];
    var today = day0(props.today || new Date()), months = props.months || 1;
    var gridRef = React.useRef(null), wantFocus = React.useRef(false);
    React.useEffect(function () { if (wantFocus.current && gridRef.current) { var el = gridRef.current.querySelector('[data-focus="1"]'); if (el) el.focus(); wantFocus.current = false; } });
    function disabled(d) { return (props.min && d < day0(props.min)) || (props.max && d > day0(props.max)); }
    function pick(d) {
      if (disabled(d)) return;
      if (!range) { c[1](d); return; }
      var f = val && val.from, t = val && val.to;
      if (!f || (f && t)) c[1]({ from: d, to: null });
      else c[1](d < f ? { from: d, to: f } : { from: f, to: d });
    }
    function moveFocus(d) {
      fc[1](d); wantFocus.current = true;
      var last = addMonths(view, months - 1);
      if (d < view) vm[1](new Date(d.getFullYear(), d.getMonth(), 1));
      else if (d >= addMonths(last, 1)) vm[1](new Date(d.getFullYear(), d.getMonth() - months + 1, 1));
    }
    function onKey(e) {
      var k = e.key, n = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[k];
      if (n) { moveFocus(addDays(focus, n)); e.preventDefault(); }
      else if (k === 'PageUp') { moveFocus(addMonths(focus, -1)); e.preventDefault(); }
      else if (k === 'PageDown') { moveFocus(addMonths(focus, 1)); e.preventDefault(); }
      else if (k === 'Enter' || k === ' ') { pick(focus); e.preventDefault(); }
    }
    var from = range && val ? val.from : null, to = range && val ? (val.to || (from && hover && hover > from ? hover : null)) : null;
    var grids = [];
    for (var m = 0; m < months; m++) {
      var first = addMonths(view, m), off = (first.getDay() + 6) % 7, start = addDays(first, -off), cells = [];
      for (var i = 0; i < 42; i++) {
        var d = addDays(start, i), out = d.getMonth() !== first.getMonth();
        if (out && i >= 35 && cells.length === 35) break;
        var sel = range ? (sameDay(d, from) || sameDay(d, to)) : sameDay(d, val);
        var inR = range && from && to && d > from && d < to;
        cells.push(h('button', {
          key: i, type: 'button', role: 'gridcell', tabIndex: !out && sameDay(d, focus) ? 0 : -1, 'data-focus': !out && sameDay(d, focus) ? '1' : undefined,
          'aria-selected': sel || undefined, 'aria-label': fmtDate(d, true), disabled: disabled(d) || undefined,
          className: cx('gr-day', out && 'gr-day-out', sameDay(d, today) && 'gr-day-today', sel && 'gr-day-sel', inR && 'gr-day-range',
            range && from && to && sameDay(d, from) && 'gr-day-start', range && from && to && sameDay(d, to) && 'gr-day-end'),
          onClick: (function (dd) { return function () { fc[1](dd); pick(dd); }; })(d),
          onPointerEnter: range ? (function (dd) { return function () { hv[1](dd); }; })(d) : undefined,
          style: out ? { visibility: 'hidden' } : null
        }, h('span', null, d.getDate())));
      }
      grids.push(h('div', { key: m, className: 'gr-cal-month' },
        h('div', { className: 'gr-cal-head' },
          m === 0 ? h('button', { type: 'button', className: 'gr-cal-nav', 'aria-label': '上个月', onClick: function () { vm[1](addMonths(view, -1)); } }, glyph('chevron-left', 16)) : h('span', { className: 'gr-cal-nav-ph' }),
          h('span', { className: 'gr-cal-title', 'aria-live': 'polite' }, first.getFullYear() + ' 年 ' + (first.getMonth() + 1) + ' 月'),
          m === months - 1 ? h('button', { type: 'button', className: 'gr-cal-nav', 'aria-label': '下个月', onClick: function () { vm[1](addMonths(view, 1)); } }, glyph('chevron-right', 16)) : h('span', { className: 'gr-cal-nav-ph' })),
        h('div', { className: 'gr-cal-week', 'aria-hidden': true }, WEEK.map(function (w) { return h('span', { key: w }, w); })),
        h('div', { className: 'gr-cal-grid', role: 'grid', onKeyDown: onKey, onPointerLeave: function () { hv[1](null); } }, cells)));
    }
    return h('div', { ref: gridRef, className: cx('gr-calendar', props.className) }, grids);
  }

  // ---------- DatePicker & DateRangePicker ----------
  function DatePicker(props) {
    var c = useControlled(props.value, props.defaultValue || null, props.onChange), val = c[0];
    var id = useStableId('gr-dp-');
    return h('div', { className: cx('gr-field', props.className) },
      props.label ? h('label', { className: 'gr-label', htmlFor: id }, props.label) : null,
      h(Popover, { defaultOpen: props.defaultOpen, label: '选择日期', trigger: h('button', { id: id, type: 'button', className: 'gr-select-trigger gr-date-trigger' },
          h('span', { className: 'gr-date-icon' }, glyph('calendar', 16)),
          h('span', { className: val ? null : 'gr-select-placeholder', style: { flex: 1 } }, val ? fmtDate(val, true) : (props.placeholder || '选择日期'))) },
        function (close) { return h(Calendar, { value: val, today: props.today, min: props.min, max: props.max, onChange: function (d) { c[1](d); close(); } }); }));
  }
  function presetRanges(today) {
    var t = day0(today || new Date()), som = new Date(t.getFullYear(), t.getMonth(), 1);
    return [
      { label: '今天', value: { from: t, to: t } },
      { label: '最近 7 天', value: { from: addDays(t, -6), to: t } },
      { label: '最近 30 天', value: { from: addDays(t, -29), to: t } },
      { label: '本月', value: { from: som, to: t } },
      { label: '上个月', value: { from: addMonths(som, -1), to: addDays(som, -1) } }
    ];
  }
  function DateRangePicker(props) {
    var c = useControlled(props.value, props.defaultValue || null, props.onChange), val = c[0];
    var dr = React.useState(val || {}), draft = dr[0];
    var presets = props.presets || presetRanges(props.today);
    var label = val && val.from ? fmtDate(val.from) + ' – ' + fmtDate(val.to || val.from) : (props.placeholder || '选择日期范围');
    return h('div', { className: cx('gr-field', props.className) },
      props.label ? h('span', { className: 'gr-label' }, props.label) : null,
      h(Popover, { defaultOpen: props.defaultOpen, label: '选择日期范围', width: 'auto', trigger: h('button', { type: 'button', className: 'gr-select-trigger gr-date-trigger' },
          h('span', { className: 'gr-date-icon' }, glyph('calendar', 16)), h('span', { className: val ? null : 'gr-select-placeholder', style: { flex: 1 } }, label)) },
        function (close) {
          return h('div', { className: 'gr-range-pop' },
            h('ul', { className: 'gr-range-presets' }, presets.map(function (p, i) {
              var on = draft.from && draft.to && sameDay(draft.from, p.value.from) && sameDay(draft.to, p.value.to);
              return h('li', { key: i }, h('button', { type: 'button', className: cx('gr-option', on && 'gr-option-active'), onClick: function () { dr[1](p.value); } }, h('span', null, p.label), on ? h('span', { className: 'gr-option-check' }, glyph('check', 14)) : null));
            })),
            h('div', { className: 'gr-range-main' },
              h(Calendar, { mode: 'range', months: props.months || 2, value: draft, today: props.today, onChange: function (v) { dr[1](v); } }),
              h('div', { className: 'gr-range-foot' },
                h('span', { className: 'gr-range-sum' }, draft.from ? fmtDate(draft.from, true) + ' – ' + (draft.to ? fmtDate(draft.to, true) : '…') : '选择开始日期'),
                h(Button, { size: 'sm', onClick: function () { dr[1](val || {}); close(); } }, '取消'),
                h(Button, { size: 'sm', variant: 'primary', disabled: !(draft.from && draft.to), onClick: function () { c[1](draft); close(); } }, '应用'))));
        }));
  }

  // ---------- Combobox ----------
  function Combobox(props) {
    var options = props.options || [];
    var c = useControlled(props.value, props.defaultValue, props.onChange), cur = c[0];
    var o = React.useState(!!props.defaultOpen), open = o[0], setOpen = o[1];
    var q = React.useState(''), query = q[0];
    var a = React.useState(0), active = a[0], setActive = a[1];
    var ref = React.useRef(null), input = React.useRef(null), id = useStableId('gr-cb-');
    useOutside(ref, open, function () { setOpen(false); q[1](''); });
    var curOpt = options.filter(function (op) { return op.value === cur; })[0];
    var shown = options.filter(function (op) { var s = (String(op.label) + ' ' + (op.keywords || '')).toLowerCase(); return s.indexOf(query.trim().toLowerCase()) >= 0; });
    function pick(op) { if (!op || op.disabled) return; c[1](op.value); setOpen(false); q[1](''); }
    function onKey(e) {
      if (e.key === 'ArrowDown') { if (!open) setOpen(true); setActive(Math.min(shown.length - 1, active + 1)); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { setActive(Math.max(0, active - 1)); e.preventDefault(); }
      else if (e.key === 'Enter') { if (open) { pick(shown[active]); e.preventDefault(); } }
      else if (e.key === 'Escape') { setOpen(false); q[1](''); }
    }
    return h('div', { ref: ref, className: cx('gr-field gr-select', props.className) },
      props.label ? h('label', { className: 'gr-label', htmlFor: id }, props.label) : null,
      h('div', { className: cx('gr-select-trigger gr-combo', open && 'gr-select-open') },
        h('span', { className: 'gr-date-icon' }, glyph('search', 16)),
        h('input', { ref: input, id: id, className: 'gr-combo-input', role: 'combobox', 'aria-expanded': open, 'aria-controls': id + '-list', 'aria-autocomplete': 'list',
          'aria-activedescendant': open && shown[active] ? id + '-o' + active : undefined,
          value: open ? query : (curOpt ? String(curOpt.label) : ''), placeholder: curOpt && open ? String(curOpt.label) : (props.placeholder || '搜索…'),
          onFocus: function () { setOpen(true); setActive(0); }, onChange: function (e) { q[1](e.target.value); setOpen(true); setActive(0); }, onKeyDown: onKey }),
        h('span', { className: 'gr-select-chevron' }, glyph('chevron-down', 16))),
      open ? h('ul', { id: id + '-list', role: 'listbox', className: 'gr-pop gr-select-list' },
        shown.length ? shown.map(function (op, i) {
          var on = op.value === cur;
          return h('li', { key: op.value, id: id + '-o' + i, role: 'option', 'aria-selected': on, className: cx('gr-option', i === active && 'gr-option-active', op.disabled && 'gr-option-disabled'),
            onPointerEnter: function () { setActive(i); }, onPointerDown: function (e) { e.preventDefault(); }, onClick: function () { pick(op); } },
            h('span', { className: 'gr-option-main' }, op.icon ? glyph(op.icon, 16) : null, h('span', null, op.label), op.hint ? h('span', { className: 'gr-option-hint' }, op.hint) : null),
            on ? h('span', { className: 'gr-option-check' }, glyph('check', 14)) : null);
        }) : h('li', { className: 'gr-option-empty' }, props.emptyText || '没有匹配的结果')) : null);
  }

  // ---------- CommandPalette ----------
  function CommandPalette(props) {
    var q = React.useState(''), query = q[0];
    var a = React.useState(0), active = a[0], setActive = a[1];
    var panel = React.useRef(null), listRef = React.useRef(null);
    useModalFocus(props.open, panel, props.onClose);
    React.useEffect(function () { if (!props.open) { q[1](''); setActive(0); } }, [props.open]);
    React.useEffect(function () { var el = listRef.current && listRef.current.querySelector('.gr-option-active'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }, [active]);
    if (!props.open) return null;
    var flat = [], groups = (props.groups || []).map(function (g) {
      var items = (g.items || []).filter(function (it) { return (it.label + ' ' + (it.keywords || '')).toLowerCase().indexOf(query.trim().toLowerCase()) >= 0; });
      items.forEach(function (it) { flat.push(it); });
      return { heading: g.heading, items: items };
    }).filter(function (g) { return g.items.length; });
    function run(it) { if (!it) return; if (it.onSelect) it.onSelect(); if (props.onClose) props.onClose(); }
    function onKey(e) {
      if (e.key === 'ArrowDown') { setActive(Math.min(flat.length - 1, active + 1)); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { setActive(Math.max(0, active - 1)); e.preventDefault(); }
      else if (e.key === 'Enter') { run(flat[active]); e.preventDefault(); }
    }
    var n = -1;
    return h('div', { className: 'gr-dialog-layer gr-cmd-layer', onPointerDown: function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); } },
      h('div', { ref: panel, className: 'gr-cmd', role: 'dialog', 'aria-modal': true, 'aria-label': props.label || '命令面板' },
        h('div', { className: 'gr-cmd-search' }, glyph('search', 18),
          h('input', { className: 'gr-cmd-input', placeholder: props.placeholder || '搜索命令、页面或设置…', value: query, role: 'combobox', 'aria-expanded': true, 'aria-controls': 'gr-cmd-list',
            onChange: function (e) { q[1](e.target.value); setActive(0); }, onKeyDown: onKey })),
        h('div', { ref: listRef, id: 'gr-cmd-list', className: 'gr-cmd-list', role: 'listbox' },
          groups.length ? groups.map(function (g, gi) {
            return h('div', { key: gi, className: 'gr-cmd-group', role: 'group', 'aria-label': g.heading },
              g.heading ? h('p', { className: 'gr-cmd-heading' }, g.heading) : null,
              g.items.map(function (it) {
                n++; var idx = n;
                return h('div', { key: idx, role: 'option', 'aria-selected': idx === active, className: cx('gr-option gr-cmd-item', idx === active && 'gr-option-active'),
                  onPointerEnter: function () { setActive(idx); }, onClick: function () { run(it); } },
                  h('span', { className: 'gr-option-main' }, it.icon ? h('span', { className: 'gr-cmd-icon' }, glyph(it.icon, 16)) : null, h('span', null, it.label)),
                  it.shortcut ? h('span', { className: 'gr-cmd-keys' }, [].concat(it.shortcut).map(function (k, ki) { return h(Kbd, { key: ki }, k); })) : null);
              }));
          }) : h('p', { className: 'gr-cmd-empty' }, '没有找到相关结果'))));
  }

  // ---------- InputOTP ----------
  function InputOTP(props) {
    var len = props.length || 6;
    var c = useControlled(props.value, props.defaultValue || '', props.onChange), val = c[0] || '';
    var refs = React.useRef([]);
    function setAt(i, ch) {
      var arr = val.split(''); arr[i] = ch; var nv = arr.join('').slice(0, len); c[1](nv);
      if (nv.length === len && props.onComplete) props.onComplete(nv);
    }
    var boxes = [];
    for (var i = 0; i < len; i++) (function (i) {
      boxes.push(h('input', {
        key: i, ref: function (el) { refs.current[i] = el; }, className: cx('gr-otp-box', val[i] && 'gr-otp-filled'), inputMode: 'numeric', autoComplete: i === 0 ? 'one-time-code' : 'off',
        maxLength: 1, value: val[i] || '', 'aria-label': '第 ' + (i + 1) + ' 位', disabled: props.disabled,
        onChange: function (e) { var ch = e.target.value.replace(/\D/g, '').slice(-1); if (!ch) return; setAt(i, ch); if (refs.current[i + 1]) refs.current[i + 1].focus(); },
        onKeyDown: function (e) {
          if (e.key === 'Backspace') { e.preventDefault(); if (val[i]) setAt(i, ''); else if (i > 0) { refs.current[i - 1].focus(); var arr = val.split(''); arr.splice(i - 1, 1); c[1](arr.join('')); } }
          else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1].focus();
          else if (e.key === 'ArrowRight' && i < len - 1) refs.current[i + 1].focus();
        },
        onPaste: function (e) { var t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, len); if (t) { e.preventDefault(); c[1](t); var k = Math.min(t.length, len - 1); if (refs.current[k]) refs.current[k].focus(); if (t.length === len && props.onComplete) props.onComplete(t); } }
      }));
      if (props.groupSize && (i + 1) % props.groupSize === 0 && i < len - 1) boxes.push(h('span', { key: 's' + i, className: 'gr-otp-sep', 'aria-hidden': true }));
    })(i);
    return h('div', { className: cx('gr-field', props.className) },
      props.label ? h('span', { className: 'gr-label' }, props.label) : null,
      h('div', { className: cx('gr-otp', props.error && 'gr-otp-invalid'), role: 'group', 'aria-label': typeof props.label === 'string' ? props.label : '验证码' }, boxes),
      props.error ? h('p', { className: 'gr-msg gr-msg-error' }, props.error) : props.hint ? h('p', { className: 'gr-msg' }, props.hint) : null);
  }

  // ======================================================================
  // More general-purpose components
  // ======================================================================

  // ---------- Tag (removable chip) & TagInput ----------
  function Tag(props) {
    return h('span', { className: cx('gr-tag', props.tone && 'gr-tag-' + props.tone, props.className) },
      props.icon ? glyph(props.icon, 14) : null,
      h('span', null, props.children),
      props.onRemove ? h('button', { type: 'button', className: 'gr-tag-x', 'aria-label': '移除 ' + (typeof props.children === 'string' ? props.children : ''), onClick: props.onRemove }, glyph('x', 12, 2.5)) : null);
  }
  function TagInput(props) {
    var c = useControlled(props.value, props.defaultValue || [], props.onChange), tags = c[0] || [];
    var t = React.useState(''), text = t[0];
    var id = useStableId('gr-ti-');
    function add(v) { v = v.trim(); if (!v || tags.indexOf(v) >= 0 || (props.max && tags.length >= props.max)) return; c[1](tags.concat([v])); t[1](''); }
    return h('div', { className: cx('gr-field', props.className) },
      props.label ? h('label', { className: 'gr-label', htmlFor: id }, props.label) : null,
      h('div', { className: 'gr-taginput', onClick: function (e) { var i = e.currentTarget.querySelector('input'); if (i) i.focus(); } },
        tags.map(function (tg, i) { return h(Tag, { key: tg, onRemove: function () { c[1](tags.filter(function (_, j) { return j !== i; })); } }, tg); }),
        h('input', { id: id, className: 'gr-taginput-field', value: text, placeholder: tags.length ? '' : (props.placeholder || '输入后按回车添加'),
          onChange: function (e) { t[1](e.target.value); },
          onKeyDown: function (e) {
            if ((e.key === 'Enter' || e.key === ',' || e.key === '，') && !e.nativeEvent.isComposing) { e.preventDefault(); add(text); }
            else if (e.key === 'Backspace' && !text && tags.length) c[1](tags.slice(0, -1));
          }, onBlur: function () { add(text); } })),
      props.hint ? h('p', { className: 'gr-msg' }, props.hint) : null);
  }

  // ---------- NumberInput ----------
  function NumberInput(props) {
    var min = props.min != null ? props.min : -Infinity, max = props.max != null ? props.max : Infinity, step = props.step || 1;
    var c = useControlled(props.value, props.defaultValue != null ? props.defaultValue : 0, props.onChange), v = c[0];
    var id = useStableId('gr-num-');
    function clamp(n) { return Math.min(max, Math.max(min, n)); }
    function set(n) { if (isNaN(n)) return; c[1](clamp(+(+n).toFixed(10))); }
    return h('div', { className: cx('gr-field', props.className) },
      props.label ? h('label', { className: 'gr-label', htmlFor: id }, props.label) : null,
      h('div', { className: cx('gr-number', props.disabled && 'gr-number-disabled') },
        h('button', { type: 'button', className: 'gr-number-btn', 'aria-label': '减少', disabled: props.disabled || v <= min, onClick: function () { set(v - step); } }, glyph('minus', 16)),
        h('input', { id: id, className: 'gr-number-input', inputMode: 'decimal', role: 'spinbutton', 'aria-valuenow': v, 'aria-valuemin': isFinite(min) ? min : undefined, 'aria-valuemax': isFinite(max) ? max : undefined,
          value: v, disabled: props.disabled,
          onChange: function (e) { var n = parseFloat(e.target.value); if (!isNaN(n)) set(n); },
          onKeyDown: function (e) { if (e.key === 'ArrowUp') { set(v + step); e.preventDefault(); } if (e.key === 'ArrowDown') { set(v - step); e.preventDefault(); } } }),
        props.unit ? h('span', { className: 'gr-number-unit' }, props.unit) : null,
        h('button', { type: 'button', className: 'gr-number-btn', 'aria-label': '增加', disabled: props.disabled || v >= max, onClick: function () { set(v + step); } }, glyph('plus', 16))),
      props.hint ? h('p', { className: 'gr-msg' }, props.hint) : null);
  }

  // ---------- FileUpload (drop zone) ----------
  function FileUpload(props) {
    var d = React.useState(false), over = d[0], setOver = d[1];
    var input = React.useRef(null);
    function take(list) { var files = Array.prototype.slice.call(list || []); if (files.length && props.onFiles) props.onFiles(files); }
    return h('div', { className: cx('gr-field', props.className) },
      props.label ? h('span', { className: 'gr-label' }, props.label) : null,
      h('div', {
        className: cx('gr-drop', over && 'gr-drop-over', props.disabled && 'gr-drop-disabled'), role: 'button', tabIndex: props.disabled ? -1 : 0,
        'aria-label': (props.title || '点击或拖拽文件到这里上传'),
        onClick: function () { if (!props.disabled && input.current) input.current.click(); },
        onKeyDown: function (e) { if ((e.key === 'Enter' || e.key === ' ') && input.current) { e.preventDefault(); input.current.click(); } },
        onDragOver: function (e) { e.preventDefault(); if (!props.disabled) setOver(true); },
        onDragLeave: function () { setOver(false); },
        onDrop: function (e) { e.preventDefault(); setOver(false); if (!props.disabled) take(e.dataTransfer.files); }
      },
        h('span', { className: 'gr-drop-icon' }, glyph('upload', 20)),
        h('p', { className: 'gr-drop-title' }, props.title || h(React.Fragment, null, '拖拽文件到这里，或 ', h('span', { className: 'gr-drop-link' }, '点击选择'))),
        props.hint ? h('p', { className: 'gr-drop-hint' }, props.hint) : null,
        h('input', { ref: input, type: 'file', hidden: true, multiple: props.multiple, accept: props.accept, onChange: function (e) { take(e.target.files); e.target.value = ''; } })),
      props.children ? h('div', { className: 'gr-drop-list' }, props.children) : null);
  }

  // ---------- DescriptionList (key–value details) ----------
  function DescriptionList(props) {
    var items = props.items || [], cols = props.columns || 1;
    return h('dl', { className: cx('gr-dl', props.className), style: { gridTemplateColumns: 'repeat(' + cols + ', minmax(0, 1fr))' } },
      items.map(function (it, i) {
        return h('div', { key: i, className: 'gr-dl-row', style: it.span ? { gridColumn: 'span ' + Math.min(it.span, cols) } : null },
          h('dt', null, it.label), h('dd', null, it.value));
      }));
  }

  // ---------- Stepper (horizontal wizard steps) ----------
  function Stepper(props) {
    var steps = props.steps || [], cur = props.current || 0;
    return h('ol', { className: cx('gr-stepper', props.className), 'aria-label': props.label || '步骤' }, steps.map(function (s, i) {
      var state = i < cur ? 'done' : i === cur ? 'current' : 'todo';
      var st = typeof s === 'string' ? { title: s } : s;
      return h('li', { key: i, className: cx('gr-stp', 'gr-stp-' + state), 'aria-current': state === 'current' ? 'step' : undefined },
        h('span', { className: 'gr-stp-mark' }, state === 'done' ? glyph('check', 14, 2.5) : i + 1),
        h('span', { className: 'gr-stp-text' },
          h('span', { className: 'gr-stp-title' }, st.title),
          st.description ? h('span', { className: 'gr-stp-desc' }, st.description) : null),
        i < steps.length - 1 ? h('span', { className: 'gr-stp-line', 'aria-hidden': true }) : null);
    }));
  }

  // ======================================================================
  // Professional-software components: menus, toolbars, panels, trees
  // ======================================================================

  // ---------- MenuBar (文件 编辑 视图 …) ----------
  function MenuBar(props) {
    var menus = props.menus || [];
    var o = React.useState(props.defaultOpen != null ? props.defaultOpen : -1), open = o[0], setOpen = o[1];
    var a = React.useState(-1), active = a[0], setActive = a[1];
    var ref = React.useRef(null);
    useOutside(ref, open >= 0, function () { setOpen(-1); });
    function items(i) { return (menus[i] && menus[i].items) || []; }
    function step(dir) {
      var list = items(open), n = list.length, j = active;
      for (var k = 0; k < n; k++) { j = (j + dir + n) % n; if (!list[j].separator && !list[j].disabled) { setActive(j); return; } }
    }
    function choose(it) { if (!it || it.disabled || it.separator) return; setOpen(-1); if (it.onSelect) it.onSelect(); }
    function onKey(e, i) {
      if (e.key === 'ArrowRight') { setOpen((i + 1) % menus.length); setActive(-1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { setOpen((i - 1 + menus.length) % menus.length); setActive(-1); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { if (open < 0) setOpen(i); step(1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { step(-1); e.preventDefault(); }
      else if (e.key === 'Enter' && open >= 0 && active >= 0) { choose(items(open)[active]); e.preventDefault(); }
    }
    return h('div', { ref: ref, className: cx('gr-menubar', props.className), role: 'menubar', 'aria-label': props.label || '菜单栏' },
      menus.map(function (m, i) {
        var on = open === i;
        return h('div', { key: i, className: 'gr-menubar-item' },
          h('button', { type: 'button', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': on, className: cx('gr-menubar-trigger', on && 'gr-menubar-on'),
            onClick: function () { setOpen(on ? -1 : i); setActive(-1); }, onPointerEnter: function () { if (open >= 0 && !on) { setOpen(i); setActive(-1); } }, onKeyDown: function (e) { onKey(e, i); } }, m.label),
          on ? h('ul', { role: 'menu', className: 'gr-pop gr-menu-list gr-menubar-list' }, m.items.map(function (it, j) {
            if (it.separator) return h('li', { key: 's' + j, role: 'separator', className: 'gr-menu-sep' });
            return h('li', { key: j, role: 'menuitem', 'aria-disabled': it.disabled || undefined, className: cx('gr-option', j === active && 'gr-option-active', it.disabled && 'gr-option-disabled', it.danger && 'gr-option-danger'),
              onPointerEnter: function () { setActive(j); }, onClick: function () { choose(it); } },
              h('span', { className: 'gr-option-main' }, h('span', { className: 'gr-menu-check' }, it.checked ? glyph('check', 14) : null), h('span', null, it.label)),
              it.shortcut ? h('kbd', { className: 'gr-kbd' }, it.shortcut) : null);
          })) : null);
      }));
  }

  // ---------- Toolbar ----------
  function Toolbar(props) {
    return h('div', { className: cx('gr-toolbar', props.vertical && 'gr-toolbar-v', props.className), role: 'toolbar', 'aria-label': props.label, 'aria-orientation': props.vertical ? 'vertical' : undefined },
      (props.groups || []).map(function (g, gi) {
        return h(React.Fragment, { key: gi },
          gi > 0 ? h('span', { className: 'gr-toolbar-sep', role: 'separator' }) : null,
          g.map(function (it, ii) {
            if (it.render) return h(React.Fragment, { key: ii }, it.render);
            var title = it.label + (it.shortcut ? '  ' + it.shortcut : '');
            return h('button', { key: ii, type: 'button', className: cx('gr-tool', it.active && 'gr-tool-on'), title: title, 'aria-label': it.label, 'aria-pressed': it.active !== undefined ? !!it.active : undefined, disabled: it.disabled, onClick: it.onClick },
              glyph(it.icon, 18), it.text ? h('span', { className: 'gr-tool-text' }, it.text) : null);
          }));
      }),
      props.children ? h('div', { className: 'gr-toolbar-end' }, props.children) : null);
  }

  // ---------- DocTabs (document tabs, closable) ----------
  function DocTabs(props) {
    var tabs = props.tabs || [];
    var c = useControlled(props.value, props.defaultValue || (tabs[0] && tabs[0].value), props.onChange), cur = c[0];
    return h('div', { className: cx('gr-doctabs', props.className), role: 'tablist', 'aria-label': props.label || '打开的文件' },
      tabs.map(function (t) {
        var on = t.value === cur;
        return h('div', { key: t.value, className: cx('gr-doctab', on && 'gr-doctab-on') },
          h('button', { type: 'button', role: 'tab', 'aria-selected': on, className: 'gr-doctab-btn', onClick: function () { c[1](t.value); } },
            t.icon ? glyph(t.icon, 15) : null, h('span', { className: 'gr-doctab-label' }, t.label)),
          props.onClose ? h('button', { type: 'button', className: cx('gr-doctab-x', t.dirty && 'gr-doctab-dirty'), 'aria-label': (t.dirty ? '未保存，' : '') + '关闭 ' + t.label, onClick: function () { props.onClose(t.value); } },
            h('span', { className: 'gr-doctab-dot', 'aria-hidden': true }), glyph('x', 13, 2.25)) : null);
      }),
      props.onAdd ? h('button', { type: 'button', className: 'gr-doctab-add', 'aria-label': '新建', onClick: props.onAdd }, glyph('plus', 15)) : null);
  }

  // ---------- TreeView ----------
  function TreeView(props) {
    var data = props.items || [];
    var ex = React.useState(props.defaultExpanded || []), expanded = ex[0], setExpanded = ex[1];
    var c = useControlled(props.selected, props.defaultSelected, props.onSelect), sel = c[0];
    var flat = [];
    (function walk(nodes, depth, parent) {
      nodes.forEach(function (n) {
        flat.push({ node: n, depth: depth, parent: parent });
        if (n.children && expanded.indexOf(n.id) >= 0) walk(n.children, depth + 1, n.id);
      });
    })(data, 0, null);
    var fc = React.useState(sel || (flat[0] && flat[0].node.id)), focus = fc[0];
    var ref = React.useRef(null);
    function toggle(id) { setExpanded(expanded.indexOf(id) >= 0 ? expanded.filter(function (x) { return x !== id; }) : expanded.concat([id])); }
    function focusId(id) { fc[1](id); setTimeout(function () { var el = ref.current && ref.current.querySelector('[data-id="' + id + '"]'); if (el) el.focus(); }, 0); }
    function onKey(e, row, idx) {
      var n = row.node, isOpen = expanded.indexOf(n.id) >= 0;
      if (e.key === 'ArrowDown' && flat[idx + 1]) { focusId(flat[idx + 1].node.id); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && flat[idx - 1]) { focusId(flat[idx - 1].node.id); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { if (n.children && !isOpen) toggle(n.id); else if (n.children && flat[idx + 1]) focusId(flat[idx + 1].node.id); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { if (n.children && isOpen) toggle(n.id); else if (row.parent) focusId(row.parent); e.preventDefault(); }
      else if (e.key === 'Enter' || e.key === ' ') { c[1](n.id); e.preventDefault(); }
    }
    return h('ul', { ref: ref, className: cx('gr-tree', props.className), role: 'tree', 'aria-label': props.label },
      flat.map(function (row, idx) {
        var n = row.node, isOpen = expanded.indexOf(n.id) >= 0, on = sel === n.id;
        return h('li', { key: n.id, role: 'treeitem', 'aria-expanded': n.children ? isOpen : undefined, 'aria-selected': on, 'aria-level': row.depth + 1,
          'data-id': n.id, tabIndex: focus === n.id ? 0 : -1, className: cx('gr-tree-row', on && 'gr-tree-on'), style: { paddingLeft: 6 + row.depth * 16 },
          onClick: function () { fc[1](n.id); c[1](n.id); }, onDoubleClick: function () { if (n.children) toggle(n.id); }, onKeyDown: function (e) { onKey(e, row, idx); } },
          h('span', { className: cx('gr-tree-chev', n.children && 'gr-tree-chev-has', isOpen && 'gr-tree-chev-open'), onClick: function (e) { if (n.children) { e.stopPropagation(); toggle(n.id); } } }, n.children ? glyph('chevron-right', 14) : null),
          h('span', { className: 'gr-tree-icon' }, n.fileName ? h(FileIcon, { name: n.fileName, size: 16 }) : glyph(n.icon || (n.children ? (isOpen ? 'folder-open' : 'folder') : 'file'), 15)),
          h('span', { className: 'gr-tree-label' }, n.label),
          n.meta != null ? h('span', { className: 'gr-tree-meta' }, n.meta) : null,
          n.actions ? h('span', { className: 'gr-tree-actions', onClick: function (e) { e.stopPropagation(); } }, n.actions) : null);
      }));
  }

  // ---------- Inspector (property panel) ----------
  function Inspector(props) {
    return h('div', { className: cx('gr-inspector', props.className) }, props.children);
  }
  function PropertyGroup(props) {
    var o = React.useState(props.defaultOpen !== false), open = o[0], setOpen = o[1];
    var id = useStableId('gr-pg-');
    return h('section', { className: cx('gr-pgroup', props.className) },
      h('div', { className: 'gr-pgroup-head' },
        h('button', { type: 'button', className: 'gr-pgroup-title', 'aria-expanded': open, 'aria-controls': id, onClick: function () { setOpen(!open); } },
          h('span', { className: cx('gr-tree-chev gr-tree-chev-has', open && 'gr-tree-chev-open') }, glyph('chevron-right', 14)), props.title),
        props.actions ? h('span', { className: 'gr-pgroup-actions' }, props.actions) : null),
      open ? h('div', { id: id, className: 'gr-pgroup-body' }, props.children) : null);
  }
  function PropertyRow(props) {
    return h('div', { className: cx('gr-prow', props.className) },
      h('span', { className: 'gr-prow-label', title: typeof props.label === 'string' ? props.label : undefined }, props.label),
      h('div', { className: 'gr-prow-field' }, props.children));
  }
  // a compact numeric field with a leading axis letter, drag-to-scrub
  function ScrubInput(props) {
    var c = useControlled(props.value, props.defaultValue != null ? props.defaultValue : 0, props.onChange), v = c[0];
    var step = props.step || 1, min = props.min != null ? props.min : -Infinity, max = props.max != null ? props.max : Infinity;
    function set(n) { if (!isNaN(n)) c[1](Math.min(max, Math.max(min, +(+n).toFixed(props.decimals != null ? props.decimals : 2)))); }
    var drag = React.useRef(null);
    return h('label', { className: cx('gr-scrub', props.className) },
      props.prefix ? h('span', { className: 'gr-scrub-prefix', title: '左右拖动调整',
        onPointerDown: function (e) { drag.current = { x: e.clientX, v: v }; e.currentTarget.setPointerCapture(e.pointerId); },
        onPointerMove: function (e) { if (drag.current) set(drag.current.v + Math.round((e.clientX - drag.current.x) / 2) * step); },
        onPointerUp: function () { drag.current = null; } }, typeof props.prefix === 'string' && props.prefix.length > 2 ? glyph(props.prefix, 13) : props.prefix) : null,
      h('input', { className: 'gr-scrub-input', value: v, inputMode: 'decimal', 'aria-label': props.label,
        onChange: function (e) { var n = parseFloat(e.target.value); if (!isNaN(n)) set(n); else if (e.target.value === '' || e.target.value === '-') c[1](e.target.value); },
        onKeyDown: function (e) { var m = e.shiftKey ? 10 : 1; if (e.key === 'ArrowUp') { set(+v + step * m); e.preventDefault(); } if (e.key === 'ArrowDown') { set(+v - step * m); e.preventDefault(); } } }),
      props.unit ? h('span', { className: 'gr-scrub-unit' }, props.unit) : null);
  }

  // ---------- ColorPicker ----------
  var SWATCHES = ['#0f1f38', '#4b586c', '#9aa6b8', '#ffffff', '#1559c4', '#3a8fe0', '#1a9c8c', '#4d9a3a', '#b97d0e', '#f2b632', '#de6544', '#b42a24', '#d2649a', '#7a63d8'];
  function ColorPicker(props) {
    var c = useControlled(props.value, props.defaultValue || '#1559c4', props.onChange), val = c[0];
    var t = React.useState(val), text = t[0];
    React.useEffect(function () { t[1](val); }, [val]);
    function commit(s) { var m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(s.trim()); if (m) { var hx = m[1].length === 3 ? m[1].replace(/(.)/g, '$1$1') : m[1]; c[1]('#' + hx.toLowerCase()); } else t[1](val); }
    var swatches = props.swatches || SWATCHES;
    var trigger = h('button', { type: 'button', className: 'gr-color-trigger', 'aria-label': '选择颜色，当前 ' + val }, h('span', { className: 'gr-color-chip', style: { background: val } }));
    return h('div', { className: cx('gr-color', props.className) },
      props.label ? h('span', { className: 'gr-label' }, props.label) : null,
      h('div', { className: 'gr-color-row' },
        h(Popover, { trigger: trigger, defaultOpen: props.defaultOpen, label: '选择颜色', width: 232 },
          h('div', { className: 'gr-color-pop' },
            h('div', { className: 'gr-color-grid', role: 'listbox', 'aria-label': '色板' }, swatches.map(function (s) {
              return h('button', { key: s, type: 'button', role: 'option', 'aria-selected': s === val, 'aria-label': s, className: cx('gr-swatch', s === val && 'gr-swatch-on'), style: { background: s }, onClick: function () { c[1](s); } });
            })),
            h('label', { className: 'gr-color-native' }, glyph('pipette', 14), h('span', null, '自定义颜色'),
              h('input', { type: 'color', value: val, onChange: function (e) { c[1](e.target.value); } })))),
        h('input', { className: 'gr-color-hex', value: text, spellCheck: false, 'aria-label': '十六进制颜色值', onChange: function (e) { t[1](e.target.value); }, onBlur: function (e) { commit(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter') commit(e.target.value); } }),
        props.opacity != null ? h('span', { className: 'gr-color-alpha' }, props.opacity + '%') : null));
  }

  // ---------- SplitPane (resizable panels) ----------
  function SplitPane(props) {
    var vertical = props.direction === 'vertical';
    var s = React.useState(props.defaultSize || 260), size = s[0], setSize = s[1];
    var min = props.min || 160, max = props.max || 560, ref = React.useRef(null), drag = React.useRef(null);
    var kids = React.Children.toArray(props.children);
    function move(e) {
      if (!drag.current || !ref.current) return;
      var r = ref.current.getBoundingClientRect(), p = vertical ? e.clientY - r.top : e.clientX - r.left;
      if (props.reverse) p = (vertical ? r.height : r.width) - p;
      setSize(Math.min(max, Math.max(min, p)));
    }
    var first = h('div', { className: 'gr-split-pane', style: vertical ? { height: size } : { width: size } }, props.reverse ? kids[1] : kids[0]);
    var rest = h('div', { className: 'gr-split-pane gr-split-fill' }, props.reverse ? kids[0] : kids[1]);
    var handle = h('div', {
      className: 'gr-split-handle', role: 'separator', tabIndex: 0, 'aria-orientation': vertical ? 'horizontal' : 'vertical', 'aria-valuenow': Math.round(size), 'aria-valuemin': min, 'aria-valuemax': max, 'aria-label': '调整面板大小',
      onPointerDown: function (e) { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); },
      onPointerMove: move, onPointerUp: function () { drag.current = false; },
      onKeyDown: function (e) { var d = { ArrowLeft: -16, ArrowRight: 16, ArrowUp: -16, ArrowDown: 16 }[e.key]; if (d) { setSize(Math.min(max, Math.max(min, size + (props.reverse ? -d : d)))); e.preventDefault(); } }
    }, h('span', { className: 'gr-split-grip' }));
    return h('div', { ref: ref, className: cx('gr-split', vertical && 'gr-split-v', props.className), style: props.style },
      props.reverse ? [rest, handle, first].map(function (x, i) { return h(React.Fragment, { key: i }, x); }) : [first, handle, rest].map(function (x, i) { return h(React.Fragment, { key: i }, x); }));
  }

  // ---------- ContextMenu (right-click) ----------
  function ContextMenu(props) {
    var o = React.useState(props.defaultPosition || null), pos = o[0], setPos = o[1];
    var a = React.useState(-1), active = a[0], setActive = a[1];
    var ref = React.useRef(null);
    useOutside(ref, !!pos, function () { setPos(null); });
    var items = props.items || [];
    function choose(it) { if (!it || it.disabled || it.separator) return; setPos(null); if (it.onSelect) it.onSelect(); }
    return h('div', { ref: ref, className: cx('gr-ctx', props.className), onContextMenu: function (e) { e.preventDefault(); var r = e.currentTarget.getBoundingClientRect(); setPos({ x: e.clientX - r.left, y: e.clientY - r.top }); setActive(-1); } },
      props.children,
      pos ? h('ul', { role: 'menu', className: 'gr-pop gr-menu-list gr-ctx-menu', style: { left: pos.x, top: pos.y } }, items.map(function (it, j) {
        if (it.separator) return h('li', { key: 's' + j, role: 'separator', className: 'gr-menu-sep' });
        return h('li', { key: j, role: 'menuitem', 'aria-disabled': it.disabled || undefined, className: cx('gr-option', j === active && 'gr-option-active', it.disabled && 'gr-option-disabled', it.danger && 'gr-option-danger'),
          onPointerEnter: function () { setActive(j); }, onClick: function () { choose(it); } },
          h('span', { className: 'gr-option-main' }, it.icon ? glyph(it.icon, 15) : h('span', { className: 'gr-menu-check' }), h('span', null, it.label)),
          it.shortcut ? h('kbd', { className: 'gr-kbd' }, it.shortcut) : null);
      })) : null);
  }

  // ---------- StatusBar ----------
  function StatusBar(props) {
    function render(list) { return (list || []).map(function (it, i) {
      return h('span', { key: i, className: cx('gr-status-item', it.tone && 'gr-status-' + it.tone), title: it.title },
        it.dot ? h('span', { className: 'gr-status-dot', 'aria-hidden': true }) : null, it.icon ? glyph(it.icon, 13) : null, it.label);
    }); }
    return h('footer', { className: cx('gr-statusbar', props.className), role: 'status' },
      h('div', { className: 'gr-status-side' }, render(props.left)),
      h('div', { className: 'gr-status-side' }, render(props.right)));
  }

  // internals shared with optional extension packs (e.g. extensions/ai/ai.js)
  var kit = { cx: cx, omit: omit, glyph: glyph, ico: ico, useControlled: useControlled, useStableId: useStableId, useOutside: useOutside, IconButton: IconButton, useCopy: useCopy, monotone: monotone };

  window.Grasso = Object.assign(window.Grasso || {}, {
    _kit: kit,
    Button: Button, Input: Input, Card: Card, Badge: Badge, Tabs: Tabs, Switch: Switch, Alert: Alert,
    ChartCard: ChartCard, AreaChart: AreaChart, LineChart: LineChart, BarChart: BarChart, DonutChart: DonutChart, RadialChart: RadialChart,
    Checkbox: Checkbox, RadioGroup: RadioGroup, Select: Select, Textarea: Textarea, Slider: Slider, Progress: Progress, Avatar: Avatar, AvatarGroup: AvatarGroup, Table: Table, StatCard: StatCard, Tooltip: Tooltip, Dialog: Dialog, Menu: Menu,
    Spinner: Spinner, TaskSteps: TaskSteps, CodeBlock: CodeBlock, Attachments: Attachments, Icon: Icon, FileIcon: FileIcon, setFileIcons: setFileIcons,
    Separator: Separator, Kbd: Kbd, Skeleton: Skeleton, EmptyState: EmptyState, Accordion: Accordion, Breadcrumb: Breadcrumb, Pagination: Pagination, ToggleGroup: ToggleGroup, Popover: Popover, Sheet: Sheet, Toaster: Toaster, toast: toast, Calendar: Calendar, DatePicker: DatePicker, DateRangePicker: DateRangePicker, Combobox: Combobox, CommandPalette: CommandPalette, InputOTP: InputOTP,
    Tag: Tag, TagInput: TagInput, NumberInput: NumberInput, FileUpload: FileUpload, DescriptionList: DescriptionList, Stepper: Stepper,
    MenuBar: MenuBar, Toolbar: Toolbar, DocTabs: DocTabs, TreeView: TreeView, Inspector: Inspector, PropertyGroup: PropertyGroup, PropertyRow: PropertyRow, ScrubInput: ScrubInput, ColorPicker: ColorPicker, SplitPane: SplitPane, ContextMenu: ContextMenu, StatusBar: StatusBar
  });
})();
