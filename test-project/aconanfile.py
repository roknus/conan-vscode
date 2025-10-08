from conan import ConanFile

class TestConan(ConanFile):
    name = "test_package"
    version = "0.1.0"
    
    # Binary configuration
    settings = "os", "compiler", "build_type", "arch"
    
    # Dependencies
    requires = [
        #"zlib/1.3",  # Required by Protobuf
        #"boost/1.87.0",  # For Asio networking
        #"protobuf/5.29.3",  # For network message serialization
        #"abseil/20250127.0",  # Required by Protobuf
    ]

    def requirements(self):
        self.requires("inja/3.4.0")
        self.requires("bullet3/3.25")
        #self.requires("engine/1.0")
        self.requires("niflib/1.0")
        self.requires("qt/6.8.3")

    #def build_requirements(self):
    #    self.tool_requires("protobuf/5.29.3") # For protoc compiler
    #    self.test_requires("gtest/1.14.0") # For unit testing