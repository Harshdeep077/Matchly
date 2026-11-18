"""Adds sample shared questions so you can try the test flow. Import your own bank from the Question bank page."""
import random
from models import *
Base.metadata.create_all(engine)
s = Session()
Q = [
("Python","Which keyword defines a function?","def","func","function","define"),
("Python","Which built-in type is []?","list","tuple","dict","array"),
("Python","Which of these is immutable?","tuple","list","dict","set"),
("Python","Which symbol starts a single-line comment?","#","//","--","/*"),
("Python","What does len('hello') return?","5","4","6","Error"),
("Python","Which creates an empty dictionary?","{}","[]","()","<>"),
("Python","What is 7 // 2?","3","3.5","4","2"),
("Python","Which list method adds an item to the end?","append","add","push","insert_end"),
("Python","What does range(3) produce?","0, 1, 2","1, 2, 3","0, 1, 2, 3","1, 2"),
("Python","Which keyword handles exceptions?","except","catch","rescue","handle"),
("Python","Which module is used for regular expressions?","re","regex","rx","pattern"),
("Python","What does 'a' * 3 give?","aaa","a3","Error","3a"),
("Python","Which statement exits a loop early?","break","stop","exit","halt"),
("Python","What is None in Python?","A null value object","Zero","An empty string","An empty list"),
("Python","Which is the recommended way to open a file?","with open('f.txt') as f:","f = open('f.txt') and never close it","import open('f.txt')","read('f.txt')"),
("Python","What does bool('') return?","False","True","None","Error"),
("Python","Which is a valid list comprehension?","[x for x in range(3)]","(for x in range(3))","{x in range(3)}","[for x in range(3)]"),
("Python","Which function reads text typed by the user?","input()","scan()","read()","get()"),
("Python","What does self represent in a class method?","The current instance","The class itself","A global variable","The parent class"),
("Python","Which tool installs Python packages?","pip","pyc","venv","import"),
("Java","Which method is the entry point of a Java program?","public static void main(String[] args)","public void run()","static int start()","void init()"),
("Java","Which keyword creates an object?","new","create","make","object"),
("Java","Which of these is not a primitive type?","String","int","boolean","char"),
("Java","What does JVM stand for?","Java Virtual Machine","Java Variable Method","Joint Virtual Memory","Java Visual Machine"),
("Java","Which keyword prevents a class from being inherited?","final","static","private","const"),
("Java","Which collection does not allow duplicates?","Set","List","ArrayList","Vector"),
("Java","Which interface gives objects a natural sort order?","Comparable","Runnable","Serializable","Cloneable"),
("Java","What is the default value of an int instance variable?","0","null","-1","undefined"),
("Java","Which block always runs after try and catch?","finally","final","done","end"),
("Java","Which modifier allows access only inside the same class?","private","protected","public","package"),
("JavaScript","Which keyword declares a block-scoped variable?","let","var","dim","int"),
("JavaScript","What does typeof null return?","object","null","undefined","number"),
("JavaScript","Which array method adds an item to the end?","push","add","append","insert"),
("JavaScript","What does === compare?","Value and type","Value only","Type only","Reference only"),
("JavaScript","Which function turns a JSON string into an object?","JSON.parse","JSON.stringify","JSON.object","JSON.read"),
("JavaScript","What does Array.map return?","A new array","The original array","A boolean","undefined"),
("JavaScript","Which symbol starts a single-line comment?","//","#","--","<!--"),
("JavaScript","What does console.log(1 + '2') print?","12","3","NaN","Error"),
("JavaScript","Which keyword marks a function that returns a promise?","async","defer","promise","later"),
("JavaScript","What does NaN stand for?","Not a Number","New and Null","Negative any Number","No assigned Name"),
]
added = 0
for tech, q, right, *wrong in Q:
    if s.query(Question).filter_by(tech=tech, text=q, company_id=None).first(): continue
    opts = [right] + wrong; random.shuffle(opts)
    s.add(Question(company_id=None, tech=tech, text=q, a=opts[0], b=opts[1], c=opts[2], d=opts[3], answer="ABCD"[opts.index(right)])); added += 1
s.commit(); print(f"Done. Added {added} sample questions (Python 20, Java 10, JavaScript 10).")