
/*!
 * php-unserialize-js JavaScript Library
 * https://github.com/bd808/php-unserialize-js
 *
 * Copyright 2013 Bryan Davis and contributors
 * Released under the MIT license
 * http://www.opensource.org/licenses/MIT
 */

(function (root, factory) {
    /*global define, exports, module */
    "use strict";

    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else if (typeof exports === 'object') {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory();
    } else {
        // Browser globals (root is window)
        root.phpUnserialize = factory();
    }
}(this, function () {
    "use strict";

    /**
     * Parse php serialized data into js objects.
     *
     * @param {String} phpstr Php serialized string to parse
     * @return {mixed} Parsed result
     */
    return function (phpstr) {
        var idx = 0
            , refStack = []
            , ridx = 0
            , parseNext // forward declaraton for "use strict"

            , readLength = function () {
                var del = phpstr.indexOf(':', idx)
                    , val = phpstr.substring(idx, del);
                idx = del + 2;
                return parseInt(val, 10);
            } //end readLength

            , readInt = function () {
                var del = phpstr.indexOf(';', idx)
                    , val = phpstr.substring(idx, del);
                idx = del + 1;
                return parseInt(val, 10);
            } //end readInt

            , parseAsInt = function () {
                var val = readInt();
                refStack[ridx++] = val;
                return val;
            } //end parseAsInt

            , parseAsFloat = function () {
                var del = phpstr.indexOf(';', idx)
                    , val = phpstr.substring(idx, del);
                idx = del + 1;
                val = parseFloat(val);
                refStack[ridx++] = val;
                return val;
            } //end parseAsFloat

            , parseAsBoolean = function () {
                var del = phpstr.indexOf(';', idx)
                    , val = phpstr.substring(idx, del);
                idx = del + 1;
                val = ("1" === val) ? true : false;
                refStack[ridx++] = val;
                return val;
            } //end parseAsBoolean

            , readString = function () {
                var len = readLength()
                    , utfLen = 0
                    , bytes = 0
                    , ch
                    , val;
                while (bytes < len) {
                    ch = phpstr.charCodeAt(idx + utfLen++);
                    if (ch <= 0x007F) {
                        bytes++;
                    } else if (ch > 0x07FF) {
                        bytes += 3;
                    } else {
                        bytes += 2;
                    }
                }
                val = phpstr.substring(idx, idx + utfLen);
                idx += utfLen + 2;
                return val;
            } //end readString

            , parseAsString = function () {
                var val = readString();
                refStack[ridx++] = val;
                return val;
            } //end parseAsString

            , readType = function () {
                var type = phpstr.charAt(idx);
                idx += 2;
                return type;
            } //end readType

            , readKey = function () {
                var type = readType();
                switch (type) {
                    case 'i': return readInt();
                    case 's': return readString();
                    default:
                        throw {
                            name: "Parse Error",
                            message: "Unknown key type '" + type + "' at position " +
                                (idx - 2)
                        };
                } //end switch
            }

            , parseAsArray = function () {
                var len = readLength()
                    , resultArray = []
                    , resultHash = {}
                    , keep = resultArray
                    , lref = ridx++
                    , key
                    , val
                    , i
                    , j
                    , alen;

                refStack[lref] = keep;
                for (i = 0; i < len; i++) {
                    key = readKey();
                    val = parseNext();
                    if (keep === resultArray && parseInt(key, 10) === i) {
                        // store in array version
                        resultArray.push(val);

                    } else {
                        if (keep !== resultHash) {
                            // found first non-sequential numeric key
                            // convert existing data to hash
                            for (j = 0, alen = resultArray.length; j < alen; j++) {
                                resultHash[j] = resultArray[j];
                            }
                            keep = resultHash;
                            refStack[lref] = keep;
                        }
                        resultHash[key] = val;
                    } //end if
                } //end for

                idx++;
                return keep;
            } //end parseAsArray

            , fixPropertyName = function (parsedName, baseClassName) {
                var class_name
                    , prop_name
                    , pos;
                if ("\u0000" === parsedName.charAt(0)) {
                    // "<NUL>*<NUL>property"
                    // "<NUL>class<NUL>property"
                    pos = parsedName.indexOf("\u0000", 1);
                    if (pos > 0) {
                        class_name = parsedName.substring(1, pos);
                        prop_name = parsedName.substr(pos + 1);

                        if ("*" === class_name) {
                            // protected
                            return prop_name;
                        } else if (baseClassName === class_name) {
                            // own private
                            return prop_name;
                        } else {
                            // private of a descendant
                            return class_name + "::" + prop_name;

                            // On the one hand, we need to prefix property name with
                            // class name, because parent and child classes both may
                            // have private property with same name. We don't want
                            // just to overwrite it and lose something.
                            //
                            // On the other hand, property name can be "foo::bar"
                            //
                            //     $obj = new stdClass();
                            //     $obj->{"foo::bar"} = 42;
                            //     // any user-defined class can do this by default
                            //
                            // and such property also can overwrite something.
                            //
                            // So, we can to lose something in any way.
                        }
                    }
                } else {
                    // public "property"
                    return parsedName;
                }
            }

            , parseAsObject = function () {
                var len
                    , obj = {}
                    , lref = ridx++
                    // HACK last char after closing quote is ':',
                    // but not ';' as for normal string
                    , clazzname = readString()
                    , key
                    , val
                    , i;

                refStack[lref] = obj;
                len = readLength();
                for (i = 0; i < len; i++) {
                    key = fixPropertyName(readKey(), clazzname);
                    val = parseNext();
                    obj[key] = val;
                }
                idx++;
                return obj;
            } //end parseAsObject

            , parseAsCustom = function () {
                var clazzname = readString()
                    , content = readString();
                return {
                    "__PHP_Incomplete_Class_Name": clazzname,
                    "serialized": content
                };
            } //end parseAsCustom

            , parseAsRefValue = function () {
                var ref = readInt()
                    // php's ref counter is 1-based; our stack is 0-based.
                    , val = refStack[ref - 1];
                refStack[ridx++] = val;
                return val;
            } //end parseAsRefValue

            , parseAsRef = function () {
                var ref = readInt();
                // php's ref counter is 1-based; our stack is 0-based.
                return refStack[ref - 1];
            } //end parseAsRef

            , parseAsNull = function () {
                var val = null;
                refStack[ridx++] = val;
                return val;
            }; //end parseAsNull

        parseNext = function () {
            var type = readType();
            switch (type) {
                case 'i': return parseAsInt();
                case 'd': return parseAsFloat();
                case 'b': return parseAsBoolean();
                case 's': return parseAsString();
                case 'a': return parseAsArray();
                case 'O': return parseAsObject();
                case 'C': return parseAsCustom();

                // link to object, which is a value - affects refStack
                case 'r': return parseAsRefValue();

                // PHP's reference - DOES NOT affect refStack
                case 'R': return parseAsRef();

                case 'N': return parseAsNull();
                default:
                    throw {
                        name: "Parse Error",
                        message: "Unknown type '" + type + "' at position " + (idx - 2)
                    };
            } //end switch
        }; //end parseNext

        return parseNext();
    };
}));

function var_export(mixedExpression, boolReturn) { // eslint-disable-line camelcase
    var isHTML = false;
    //  discuss at: http://locutus.io/php/var_export/
    // original by: Philip Peterson
    // improved by: johnrembo
    // improved by: Brett Zamir (http://brett-zamir.me)
    //    input by: Brian Tafoya (http://www.premasolutions.com/)
    //    input by: Hans Henrik (http://hanshenrik.tk/)
    // bugfixed by: Brett Zamir (http://brett-zamir.me)
    // bugfixed by: Brett Zamir (http://brett-zamir.me)
    //   example 1: var_export(null)
    //   returns 1: null
    //   example 2: var_export({0: 'Kevin', 1: 'van', 2: 'Zonneveld'}, true)
    //   returns 2: "array (\n  0 => 'Kevin',\n  1 => 'van',\n  2 => 'Zonneveld'\n)"
    //   example 3: var data = 'Kevin'
    //   example 3: var_export(data, true)
    //   returns 3: "'Kevin'"

    var retstr = ''
    var iret = ''
    var value
    var cnt = 0
    var x = []
    var i = 0
    var funcParts = []
    // We use the last argument (not part of PHP) to pass in
    // our indentation level
    var idtLevel = arguments[2] || 2
    var innerIndent = ''
    var outerIndent = ''
    var getFuncName = function (fn) {
        var name = (/\W*function\s+([\w$]+)\s*\(/).exec(fn)
        if (!name) {
            return '(Anonymous)'
        }
        return name[1]
    }

    var _makeIndent = function (idtLevel) {
        return (new Array(idtLevel + 1))
            .join(' ')
    }
    var __getType = function (inp) {
        var i = 0
        var match
        var types
        var cons
        var type = typeof inp
        if (type === 'object' && (inp && inp.constructor) &&
            getFuncName(inp.constructor) === 'LOCUTUS_Resource') {
            return 'resource'
        }
        if (type === 'function') {
            return 'function'
        }
        if (type === 'object' && !inp) {
            // Should this be just null?
            return 'null'
        }
        if (type === 'object') {
            if (!inp.constructor) {
                return 'object'
            }
            cons = inp.constructor.toString()
            match = cons.match(/(\w+)\(/)
            if (match) {
                cons = match[1].toLowerCase()
            }
            types = ['boolean', 'number', 'string', 'array']
            for (i = 0; i < types.length; i++) {
                if (cons === types[i]) {
                    type = types[i]
                    break
                }
            }
        }
        return type
    }
    var type = __getType(mixedExpression)

    if (type === null) {
        retstr = 'NULL'
    } else if (type === 'array' || type === 'object') {
        outerIndent = _makeIndent(idtLevel - 2)
        innerIndent = _makeIndent(idtLevel)
        for (i in mixedExpression) {
            value = var_export(mixedExpression[i], 1, idtLevel + 2)
            if (isHTML) {
                value = typeof value === 'string' ? value.replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;') : value
            }
            x[cnt++] = innerIndent + i + ' => ' +
                (__getType(mixedExpression[i]) === 'array' ? '\n' : '') + value
        }
        iret = x.join(',\n')
        retstr = outerIndent + 'array (\n' + iret + '\n' + outerIndent + ')'
    } else if (type === 'function') {
        funcParts = mixedExpression.toString().match(/function .*?\((.*?)\) \{([\s\S]*)\}/)

        // For lambda functions, var_export() outputs such as the following:
        // '\000lambda_1'. Since it will probably not be a common use to
        // expect this (unhelpful) form, we'll use another PHP-exportable
        // construct, create_function() (though dollar signs must be on the
        // variables in JavaScript); if using instead in JavaScript and you
        // are using the namespaced version, note that create_function() will
        // not be available as a global
        retstr = "create_function ('" + funcParts[1] + "', '" +
            funcParts[2].replace(new RegExp("'", 'g'), "\\'") + "')"
    } else if (type === 'resource') {
        // Resources treated as null for var_export
        retstr = 'NULL'
    } else {
        retstr = typeof mixedExpression !== 'string' ? mixedExpression
            : "'" + mixedExpression.replace(/(["'])/g, '\\$1').replace(/\0/g, '\\0') + "'"
    }

    if (!boolReturn) {
        return null
    }

    return retstr
}





// main function
document.addEventListener('DOMContentLoaded', function () {
    function convert() {
        document.querySelector('#err').innerHTML = '';

        const is_val_export = !!document.querySelector('#radio_var_export').checked;

        try {
            const jsObject = phpUnserialize(document.querySelector('#php').value);
            console.log(jsObject);

            const result = is_val_export ? var_export(jsObject, true) : JSON.stringify(jsObject, null, 4);
            console.log(result);

            document.querySelector('#var_export').value = result;
        } catch (e) {
            document.querySelector('#err').innerText = 'conversion error: ' + e.message;
        }
    }
    function trimQuotes() {
        const initialValue = document.querySelector('#php').value;


        let result = initialValue;
        if (/^'.+'$/.test(result)) result = result.replace(/^'|'$/g, '');
        if (/^".+"$/.test(result)) result = result.replace(/^"|"$/g, '');
        console.log(result);

        document.querySelector('#php').value = result;
    }

    document.querySelector('#convert').addEventListener('click', () => convert());
    document.querySelector('#trim-quotes').addEventListener('click', () => trimQuotes());
});
